import { type MouseEvent, use, useCallback, useRef, useState } from 'react';

import type { Run, RunEvent, RunStatus } from '@/types';

import { api } from '@/api';
import { Context } from '@/contexts';
import { getCollapsibleIds } from '@/utils';

type StreamFrame =
  | {
      event: 'run_end';
      data: {
        status: RunStatus;
        error: string | null;
        started_at: Date | null;
        completed_at: Date | null;
        updated_at: Date;
      };
    }
  | RunEvent;

// Shared by the MR-review and chat thread pages — same behavior, different surrounding page UI.
export function useRunStream(options?: { headers?: Record<string, string> }) {
  const { handleError } = use(Context);
  const [runs, setRuns] = useState<Run[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  // Read elsewhere to guard against double-streaming the same run — this hook only writes it.
  const streamingForRef = useRef<string | null>(null);
  // Ref, not state: setRuns's updater doesn't run synchronously, so a value set via setState couldn't be read back right after.
  const seenCollapsibleIdsRef = useRef<Set<string>>(new Set());

  const resetCollapsed = useCallback((runsList: Run[]) => {
    const ids = getCollapsibleIds(runsList);
    setCollapsed(ids);
    seenCollapsibleIdsRef.current = new Set(ids);
  }, []);

  const consumeStream = useCallback(
    async (
      stream: AsyncIterable<StreamFrame>,
      runId: string,
      signal: AbortSignal,
    ) => {
      try {
        for await (const frame of stream) {
          if (signal.aborted) break;

          if (frame.event === 'run_end') {
            const { status, error, started_at, completed_at, updated_at } =
              frame.data;
            setRuns((prev) =>
              prev.map((r) =>
                r.id === runId
                  ? {
                      ...r,
                      status,
                      error,
                      started_at,
                      completed_at,
                      updated_at,
                    }
                  : r,
              ),
            );
            continue;
          }

          const markCollapsibleIfNew = (id: string) => {
            if (seenCollapsibleIdsRef.current.has(id)) return;
            seenCollapsibleIdsRef.current.add(id);
            setCollapsed((prev) => [...prev, id]);
          };

          if (
            frame.event === 'run_step_start' ||
            frame.event === 'tool_input' ||
            frame.event === 'model_retry' ||
            frame.event === 'summarize_context_start' ||
            frame.event === 'comment_critic_start' ||
            frame.event === 'reply_critic_start' ||
            frame.event === 'corrective_nudge_start' ||
            frame.event === 'extract_project_memory_start' ||
            frame.event === 'agent_prompt'
          ) {
            markCollapsibleIfNew(frame.data.id);
          } else if (
            frame.event === 'message' &&
            (frame.data.content || frame.data.reasoningContent)
          ) {
            markCollapsibleIfNew(frame.data.id);
          } else if (frame.event === 'node_end' && frame.data.payload) {
            markCollapsibleIfNew(`node:${runId}:${frame.data.node}`);
          }

          setRuns((prev) =>
            prev.map((run) => {
              if (run.id !== runId) return run;
              const events = [...run.events];

              if (frame.event === 'message') {
                const last = events[events.length - 1];
                if (
                  last?.event === 'message' &&
                  last.data.id === frame.data.id
                ) {
                  events[events.length - 1] = {
                    event: 'message',
                    data: {
                      ...last.data,
                      content: last.data.content + frame.data.content,
                      reasoningContent:
                        last.data.reasoningContent +
                        frame.data.reasoningContent,
                    },
                  };
                } else if (frame.data.content || frame.data.reasoningContent) {
                  events.push({ event: 'message', data: { ...frame.data } });
                }
              } else if (frame.event === 'model_retry') {
                const last = events[events.length - 1];
                const updated: RunEvent = {
                  event: 'model_retry',
                  data: { ...frame.data },
                };

                if (
                  last?.event === 'model_retry' &&
                  last.data.id === frame.data.id
                ) {
                  events[events.length - 1] = updated;
                } else {
                  events.push(updated);
                }
              } else {
                events.push(frame);
              }

              return { ...run, events };
            }),
          );
        }
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') throw e;
      }
    },
    [],
  );

  // threadId is a param, not hook state: chat's "new" page creates its thread lazily on first send, so it isn't known until the call site has it.
  const doStreamRun = useCallback(
    async (threadId: string, run: Run, controller: AbortController) => {
      streamingForRef.current = run.id;
      setStreaming(true);
      try {
        const res = await api
          .threads({ id: threadId })
          .runs({ runId: run.id })
          .stream.get({
            fetch: { signal: controller.signal },
            headers: options?.headers,
          });
        if (!res?.data || res.error || controller.signal.aborted) return;
        await consumeStream(res.data, run.id, controller.signal);
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') handleError(e, 'Stream error');
      } finally {
        streamingForRef.current = null;
        setStreaming(false);
      }
    },
    [options, consumeStream, handleError],
  );

  const handleCollapse = useCallback((e: MouseEvent<HTMLElement>) => {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    setCollapsed((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  }, []);

  return {
    runs,
    setRuns,
    collapsed,
    setCollapsed,
    resetCollapsed,
    consumeStream,
    doStreamRun,
    handleCollapse,
    streamingForRef,
    streaming,
  };
}
