import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph';

import { type RunEvent, type WriterEvent } from '#types.js';

import { logger } from '#utils/logger.js';

// Carries messageId (and its reasoning-phase flags) across chunks for one stream's lifetime — a
// fresh state per translateRunStream/translateChunk-loop call, never shared across streams.
export type TranslateState = {
  messageId: string | null;
  reasoningStarted: boolean;
  reasoningEnded: boolean;
};

export function createTranslateState(): TranslateState {
  return { messageId: null, reasoningStarted: false, reasoningEnded: false };
}

// Shared by translateRunStream (main graph) and spawnSubagent's forwarding loop (nested agent stream) — 'checkpoints' is excluded since a nested stream never carries it.
export function translateChunk(
  mode: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chunk: any,
  state: TranslateState,
  knownLcSources: Set<string>,
  subagentId?: string,
): RunEvent[] {
  const events: RunEvent[] = [];

  if (mode === 'custom') {
    events.push(chunk as WriterEvent);
  }

  if (mode === 'messages') {
    // deletion marker from summarizeContextMiddleware, not a real message
    // synthetic summary message (dedicated SummarizeContextEndEvent)
    // an internal middleware LLM call (summarization, comment critic, project memory extraction, ...), not a real conversation turn
    if (
      chunk[0].type === 'tool' ||
      chunk[0].id === REMOVE_ALL_MESSAGES ||
      chunk[0].additional_kwargs?.lc_source
    ) {
      return events;
    }

    if (chunk[1]?.lc_source) {
      if (!knownLcSources.has(chunk[1].lc_source as string)) {
        logger.warn(
          { lc_source: chunk[1].lc_source },
          'unrecognized lc_source on message chunk — dropped from stream, verify this is intentional',
        );
      }

      return events;
    }

    if (!state.messageId) {
      state.messageId =
        (chunk[0].id as string | undefined) ?? crypto.randomUUID();
      state.reasoningStarted = false;
      state.reasoningEnded = false;
    }

    const reasoningContent =
      (chunk[0].additional_kwargs.reasoning_content as string) || '';

    if (reasoningContent && !state.reasoningStarted) {
      state.reasoningStarted = true;
      events.push({
        event: 'reasoning_start',
        data: {
          id: state.messageId,
          timestamp: Date.now(),
          ...(subagentId && { subagentId }),
        },
      });
    }

    // Ends once the reasoning delta itself stops flowing, not when `content` appears — a
    // tool-call-only turn (reason, then call a tool with no assistant text) never gets one.
    if (!reasoningContent && state.reasoningStarted && !state.reasoningEnded) {
      state.reasoningEnded = true;
      events.push({
        event: 'reasoning_end',
        data: {
          id: state.messageId,
          timestamp: Date.now(),
          ...(subagentId && { subagentId }),
        },
      });
    }

    events.push({
      event: 'message',
      data: {
        id: state.messageId,
        content: chunk[0].content as string,
        reasoningContent,
        ...(subagentId && { subagentId }),
      },
    });
  } else {
    state.messageId = null;
  }

  if (mode === 'tools') {
    if (chunk.event === 'on_tool_start') {
      events.push({
        event: 'tool_input',
        data: {
          id: chunk.toolCallId!,
          name: chunk.name,
          input: JSON.parse(chunk.input as string) as Record<string, unknown>,
          timestamp: Date.now(),
          ...(subagentId && { subagentId }),
        },
      });
    }
    if (chunk.event === 'on_tool_end') {
      events.push({
        event: 'tool_output',
        data: {
          id: chunk.toolCallId!,
          output: (chunk.output as { content: string }).content,
          timestamp: Date.now(),
          ...(subagentId && { subagentId }),
        },
      });
    }

    // Dead while duplicateCallGuardMiddleware is active (it catches throws itself); kept as a fallback if that middleware is ever removed.
    if (chunk.event === 'on_tool_error') {
      events.push({
        event: 'tool_output',
        data: {
          id: chunk.toolCallId!,
          output: JSON.stringify({
            error: `${(chunk.error as Error).message}`,
          }),
          timestamp: Date.now(),
          ...(subagentId && { subagentId }),
        },
      });
    }
  }

  return events;
}

// Same translation for every workflow — only the recognized lc_sources set differs per caller.
export async function* translateRunStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: AsyncIterable<[string, any]>,
  knownLcSources: Set<string>,
): AsyncGenerator<RunEvent> {
  const state = createTranslateState();

  for await (const [mode, chunk] of stream) {
    if (mode === 'checkpoints') {
      // Skip the initial input checkpoint (fresh run) and the terminal one (retry would be a no-op).
      if (chunk.metadata?.source !== 'input' && chunk.next.length > 0) {
        const checkpointId = chunk.config.configurable?.checkpoint_id;

        if (checkpointId) {
          yield { event: 'checkpoint', data: { id: checkpointId } };
        }
      }
    }

    yield* translateChunk(mode, chunk, state, knownLcSources);
  }
}
