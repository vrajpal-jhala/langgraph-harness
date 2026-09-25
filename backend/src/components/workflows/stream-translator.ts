import { REMOVE_ALL_MESSAGES } from '@langchain/langgraph';

import { type RunEvent, type WriterEvent } from '#types.js';

import { logger } from '#utils/logger.js';

// Carries messageId and reasoning-phase flags across chunks for one stream's lifetime — a fresh state per translateRunStream/translateChunk-loop call, never shared across streams.
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

  const closeReasoning = (id: string) => {
    state.reasoningEnded = true;
    events.push({
      event: 'reasoning_end',
      data: { id, timestamp: Date.now(), ...(subagentId && { subagentId }) },
    });
  };

  if (mode === 'custom') {
    events.push(chunk as WriterEvent);
  }

  if (mode === 'messages') {
    if (
      chunk[0].type === 'tool' ||
      // deletion marker from summarizeContextMiddleware, not a real message
      chunk[0].id === REMOVE_ALL_MESSAGES ||
      // synthetic summary message (dedicated SummarizeContextEndEvent)
      chunk[0].additional_kwargs?.lc_source
    ) {
      return events;
    }

    // an internal middleware LLM call (summarization, comment critic, project memory extraction, ...), not an actual conversation turn
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

    const content = chunk[0].content as string;
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

    // Ends on the reasoning delta stopping, not on `content` appearing — a tool-call-only turn never gets non-empty content.
    if (!reasoningContent && state.reasoningStarted && !state.reasoningEnded) {
      closeReasoning(state.messageId);
    }

    events.push({
      event: 'message',
      data: {
        id: state.messageId,
        content,
        reasoningContent,
        ...(subagentId && { subagentId }),
      },
    });
  } else {
    // A turn can leave 'messages' (e.g. into 'tools') without ever sending a closing empty-reasoning_content delta — close the phase here instead of leaving it dangling.
    if (state.reasoningStarted && !state.reasoningEnded && state.messageId) {
      closeReasoning(state.messageId);
    }
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
