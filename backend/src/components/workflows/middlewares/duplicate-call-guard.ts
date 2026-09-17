import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { createMiddleware } from 'langchain';

import {
  emitCorrectiveNudgeEndEvent,
  emitCorrectiveNudgeStartEvent,
  emitToolInputEvent,
  emitToolOutputEvent,
} from '#components/workflows/emit.js';

import { RunAbortedError } from '#utils/errors.js';
import { messageContent } from '#utils/helpers.js';

type GuardConfigurable = {
  toolCallCounts?: Map<string, number>;
  toolErrorCounts?: Map<string, number>;
  subagentId?: string;
};

type GuardRuntime = { configurable?: GuardConfigurable };

// Shared repeat limit for the two tracking mechanisms below (nudge count, failure streak) — both threaded through configurable, per agent.invoke() run.
const NUDGE_LIMIT = 3;
// Much higher than NUDGE_LIMIT — a read is safe to keep re-running, so only genuinely excessive repetition (not a normal spaced-out re-check) should abort it.
const READ_ABORT_LIMIT = 10;

export function duplicateCallGuardMiddleware({
  readToolNames,
}: {
  readToolNames: ReadonlySet<string>;
}) {
  const toolCallKey = (name: string, args: unknown) =>
    `${name}|${JSON.stringify(args ?? {})}`;

  // Catches a tool (ours or third-party) that reports failure via content instead of status/throw — e.g. an MCP server returning isError:false with an error body.
  const hasErrorContent = (msg: ToolMessage): boolean => {
    try {
      const parsed: unknown = JSON.parse(messageContent(msg.content));
      return (
        !!parsed &&
        typeof parsed === 'object' &&
        !!(parsed as { error?: unknown }).error
      );
    } catch {
      return false;
    }
  };

  const correctiveMessage = (
    calls: { name: string; count: number; isRead: boolean }[],
  ) => {
    const list = calls
      .map(({ name, count }) => `\`${name}\` (${count + 1} times now)`)
      .join(', ');
    const plural = calls.length > 1;
    // a write hard-aborts right at this nudge point; a read has NUDGE_LIMIT to READ_ABORT_LIMIT more room before it would — don't threaten imminent abort for a read-only repeat this early
    const abortWarning = calls.some((c) => !c.isRead)
      ? ', or the run will be aborted'
      : '';

    return (
      `You're about to call ${list} again with the exact same arguments — ` +
      `past the ${NUDGE_LIMIT}-repeat limit — despite being told each time ` +
      `that this is a wasted call. Stop calling ${plural ? 'them' : 'it'} and ` +
      `use the result${plural ? 's' : ''} you already have in this ` +
      `conversation${abortWarning}.`
    );
  };

  return createMiddleware({
    name: 'DuplicateCallGuard',
    // If this turn repeats calls that already exhausted their nudges, ask the
    // model directly to stop before it reaches the hard abort in wrapToolCall.
    // Checks every call in the batch, not just the first — a turn can loop on
    // more than one at once.
    wrapModelCall: async (request, handler) => {
      const result = await handler(request);
      const modelConfig = (request.runtime as GuardRuntime).configurable;
      const cache = modelConfig?.toolCallCounts;
      const subagentId = modelConfig?.subagentId;

      const exhausted = (result.tool_calls ?? [])
        .map((tc) => ({
          name: tc.name,
          count: cache?.get(toolCallKey(tc.name, tc.args)) ?? 0,
          isRead: readToolNames.has(tc.name),
        }))
        .filter((tc) => tc.count >= NUDGE_LIMIT);

      if (!exhausted.length) return result;

      const id = crypto.randomUUID();
      const prompt = correctiveMessage(exhausted);
      emitCorrectiveNudgeStartEvent(request.runtime, {
        id,
        middleware: 'DuplicateCallGuard',
        prompt,
        subagentId,
      });

      try {
        const rewritten = await handler({
          ...request,
          messages: [...request.messages, result, new HumanMessage(prompt)],
        });
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: '',
          subagentId,
        });
        return rewritten;
      } catch (err) {
        // Best-effort — fall back to the original result, which still hits the
        // hard abort in wrapToolCall if it's truly repeated.
        emitCorrectiveNudgeEndEvent(request.runtime, {
          id,
          error: err instanceof Error ? err.message : String(err),
          subagentId,
        });
        return result;
      }
    },
    wrapToolCall: async (request, handler) => {
      const config = (request.runtime as GuardRuntime).configurable;
      const cache = config?.toolCallCounts;
      const errors = config?.toolErrorCounts;

      const key = toolCallKey(request.toolCall.name, request.toolCall.args);
      const id = request.toolCall.id ?? '';
      const isRead = readToolNames.has(request.toolCall.name);

      // Counts CONSECUTIVE failures of this exact call and aborts past NUDGE_LIMIT.
      const bumpErrorOrAbort = (errorOutput: string) => {
        if (!errors) return;
        for (const k of [...errors.keys()]) if (k !== key) errors.delete(k); // any other call's failure breaks the streak
        const n = (errors.get(key) ?? 0) + 1;
        errors.set(key, n);
        if (n < NUDGE_LIMIT) return;

        // emit before throwing — otherwise the call that triggered the abort leaves no trace in the run's event log
        emitToolInputEvent(request.runtime, {
          id,
          name: request.toolCall.name,
          input: request.toolCall.args ?? {},
          subagentId: config?.subagentId,
        });
        emitToolOutputEvent(request.runtime, {
          id,
          output: errorOutput,
          subagentId: config?.subagentId,
        });
        throw abort('failed', NUDGE_LIMIT);
      };
      const repeatedCallMessage = (limit: number) =>
        `Tool \`${request.toolCall.name}\` was called with the same arguments ${limit} times.`;

      const abort = (reason: 'nudged' | 'failed', limit: number) =>
        new RunAbortedError(
          reason === 'nudged'
            ? `${repeatedCallMessage(limit)} Aborting run.`
            : `Tool \`${request.toolCall.name}\` failed with the same arguments ${limit} times in a row with no change. Aborting run.`,
        );

      if (cache?.has(key)) {
        const nudgeCount = cache.get(key)!;
        // a write hard-aborts as soon as it's a real duplicate; a read is safe to keep re-running, so it gets a much longer leash before the same abort kicks in
        const abortLimit = isRead ? READ_ABORT_LIMIT : NUDGE_LIMIT;

        if (nudgeCount >= abortLimit) {
          const err = abort('nudged', abortLimit);
          emitToolInputEvent(request.runtime, {
            id,
            name: request.toolCall.name,
            input: request.toolCall.args ?? {},
            subagentId: config?.subagentId,
          });
          emitToolOutputEvent(request.runtime, {
            id,
            output: JSON.stringify({ error: repeatedCallMessage(abortLimit) }),
            subagentId: config?.subagentId,
          });
          throw err;
        }

        cache.set(key, nudgeCount + 1);

        // write tools: block the exact-duplicate outright to avoid a real duplicate side effect
        if (!isRead) {
          const nudge = `You already called \`${request.toolCall.name}\` with these arguments — this is a wasted call. Refer to the tool result you already have instead of calling again.`;

          emitToolInputEvent(request.runtime, {
            id,
            name: request.toolCall.name,
            input: request.toolCall.args ?? {},
            subagentId: config?.subagentId,
          });
          emitToolOutputEvent(request.runtime, {
            id,
            output: nudge,
            subagentId: config?.subagentId,
          });

          return new ToolMessage({ content: nudge, tool_call_id: id });
        }

        // read tools: never withhold data — run live and annotate the fresh result with a repeat note
        const liveResult = await handler(request);

        // this key was cached as a success, but the live re-run itself could still fail — only a real success breaks the error streak
        if (!(
          ToolMessage.isInstance(liveResult) && hasErrorContent(liveResult)
        ))
          errors?.clear();

        if (ToolMessage.isInstance(liveResult)) {
          const note = `You have already called \`${request.toolCall.name}\` with these exact arguments ${nudgeCount} time${nudgeCount ? 's' : ''} before. This is a fresh, live result — if it looks unchanged from before, that's a real answer, not a stale one.`;
          const raw = messageContent(liveResult.content);
          let payload: unknown;

          try {
            payload = JSON.parse(raw);
          } catch {
            payload = raw;
          }

          liveResult.content = JSON.stringify(
            payload && typeof payload === 'object' && !Array.isArray(payload)
              ? { ...payload, note }
              : { result: payload, note },
          );

          // on_tool_end already fired with the raw pre-annotation output (tied to the tool's own invoke() inside handler() above) — re-emit tool_output (not tool_input, which the frontend renders per-event rather than deduping by id) so the log shows what the model actually saw.
          emitToolOutputEvent(request.runtime, {
            id,
            output: messageContent(liveResult.content),
            subagentId: config?.subagentId,
          });
        }

        return liveResult;
      }

      let result: Awaited<ReturnType<typeof handler>>;

      // not catching would crash the run; a thrown error counts as one failure
      try {
        result = await handler(request);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const content = JSON.stringify({ error: msg });

        bumpErrorOrAbort(content);
        return new ToolMessage({ content, tool_call_id: id });
      }

      // a failure the tool returned instead of throwing — mainly the model repeatedly calling a nonexistent tool name (langchain answers with status:"error", not an exception), or a middleware rejecting via a returned ToolMessage rather than a throw; count it so the loop still aborts
      if (
        ToolMessage.isInstance(result) &&
        (result.status === 'error' || hasErrorContent(result))
      ) {
        bumpErrorOrAbort(messageContent(result.content));
        return result;
      }

      // success — a real step forward, so any consecutive-failure streak (on
      // this or any other call) is broken; cache this call for duplicate detection
      errors?.clear();

      // write_todos (and other Command-returning tools) never satisfy ToolMessage.isInstance, so duplicate calls go undetected without this branch
      if (
        cache &&
        (ToolMessage.isInstance(result) || result instanceof Command)
      )
        cache.set(key, 0);

      return result;
    },
  });
}
