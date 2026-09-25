import type {
  ErrorKind,
  MessageEvent,
  MrReviewRunInput,
  RunContext,
  RunEvent,
  RunInput,
  RunMode,
  Session,
  TaskResolveRunInput,
  Workflow,
  WorkItemResolveRunInput,
} from '#types.js';
import { RunKind, RunStatus } from '#types.js';

import { analyticsService } from '#components/analytics/service.js';
import { settingsService } from '#components/settings/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { enqueueMrReview } from '#components/workflows/mr-review/queue.js';
import { workflowsService } from '#components/workflows/service.js';
import { enqueueTaskResolve } from '#components/workflows/task-resolve/queue.js';
import { enqueueWorkItemResolve } from '#components/workflows/work-item-resolve/queue.js';
import { broadcast } from '#components/ws/index.js';
import { runsDal } from './dal.js';
import { runPubSub } from './pubsub.js';

import { getGitlabAccessToken } from '#utils/auth.js';
import { config, llms } from '#utils/config.js';
import { errors, RunAbortedError } from '#utils/errors.js';
import {
  findRepeatedText,
  generationLoopReason,
  IDLE_TOOL_CALL_MS,
  REPEATED_TEXT_THRESHOLD,
} from '#utils/generation-loop.js';
import { withLock } from '#utils/lock.js';
import { logger } from '#utils/logger.js';

const abortControllers = new Map<string, AbortController>();

const RUN_TIMEOUT_BY_KIND: Record<RunKind, number> = {
  [RunKind.MrReview]: config.mrReview.runTimeout,
  [RunKind.WorkItemResolve]: config.workItemResolve.runTimeout,
  [RunKind.TaskResolve]: config.taskResolve.runTimeout,
  [RunKind.Chat]: config.chat.runTimeout,
};

function runTimeoutReason(runTimeout: number): string {
  return `Run exceeded the ${runTimeout / 60000} minute time limit`;
}

function recordRunSummary(
  runId: string,
  startedAt: Date | null | undefined,
  events: RunEvent[],
  success: boolean,
  errorKind?: ErrorKind,
) {
  if (!startedAt) return;
  const durationMs = Date.now() - startedAt.getTime();
  analyticsService
    .recordRun(
      runId,
      durationMs,
      success,
      errorKind,
      events,
      startedAt.getTime(),
    )
    .catch((err) => logger.error({ err, runId }, '[analytics] record failed'));
}

// Only chat's workflow.validateInput/stream actually reads these — mr-review's queue-driven runs have no signed-in session and never pass one in.
async function resolveSecrets(session?: Session) {
  if (!session) return undefined;
  return {
    gitlabToken: await getGitlabAccessToken(session.id),
    openRouterKey: await settingsService.getOpenRouterKey(session.id),
    userId: session.id,
  };
}

export const runsService = {
  create: async (
    id: string,
    kind: RunKind,
    input: RunInput,
    session?: Session,
  ) => {
    const thread = await threadsDal.findById(id);
    if (!thread) throw errors.threads.notFound();
    if (thread.archived_at) throw errors.threads.archived();

    const workflow = workflowsService.forKind(kind);
    const secrets = await resolveSecrets(session);
    // Validated before the run row exists, so a bad request never leaves behind an orphan QUEUED run that nothing will execute.
    workflow.validateInput?.(input as never, secrets as never);

    const run = await runsDal.insert({ thread_id: id, kind, input });
    await publishThreadUpdate(id, RunStatus.QUEUED);
    return run;
  },

  start: async (
    id: string,
    runId: string,
    kind: RunKind,
    input: RunInput,
    session?: Session,
    checkpointId?: string,
    queueWaitMs?: number,
  ): Promise<void> => {
    const workflow = workflowsService.forKind(kind);

    if (workflow.startMode === 'queued') {
      const run = await runsDal.findById(runId);
      // If the run is no longer QUEUED (superseded/deleted), skip silently.
      if (run?.status !== RunStatus.QUEUED) return;
      await publishThreadUpdate(id, RunStatus.QUEUED);
    }

    return execute(
      workflow,
      id,
      runId,
      input as never,
      (await resolveSecrets(session)) as never,
      checkpointId
        ? { mode: 'retry', fromCheckpointId: checkpointId }
        : { mode: 'fresh' },
      queueWaitMs,
    );
  },

  retry: async (
    id: string,
    runId: string,
    checkpointId?: string,
    session?: Session,
  ) => {
    const thread = await threadsDal.findById(id);

    if (!thread) throw errors.threads.notFound();
    if (thread.archived_at) throw errors.threads.archived();

    const originalRun = await runsDal.findById(runId);

    if (!originalRun) throw errors.runs.notFound();

    if (!llms.some((l) => l.model === originalRun.input.model)) {
      throw errors.runs.unknownModel(originalRun.input.model);
    }

    const workflow = workflowsService.forKind(originalRun.kind);
    const secrets = await resolveSecrets(session);

    // Validated before the run row exists, so a bad request never leaves behind an orphan QUEUED run that nothing will execute.
    workflow.validateInput?.(originalRun.input as never, secrets as never);

    // Locked so a second retry/decide on this thread can't pass hasActive before this insert commits.
    const run = await withLock(`thread-active-run:${id}`, async () => {
      // Two concurrent runs on the same thread would race on the same checkpointer thread_id.
      if (await runsDal.hasActive(id)) throw errors.runs.alreadyRunning();

      return runsDal.insert({
        thread_id: id,
        kind: originalRun.kind,
        input: originalRun.input,
        ...(checkpointId && { parent_checkpoint_id: checkpointId }),
      });
    });

    await publishThreadUpdate(id, RunStatus.QUEUED);

    if (workflow.startMode === 'queued') {
      try {
        if (originalRun.kind === RunKind.MrReview) {
          // Unique jobId avoids colliding with the per-MR debounce job; delay 0 skips debouncing.
          // Hyphen, not colon — BullMQ rejects a custom jobId containing ':' unless it splits into exactly 3 parts, which a bare UUID never does.
          await enqueueMrReview(
            `retry-${run.id}`,
            {
              threadId: id,
              runId: run.id,
              ...(originalRun.input as MrReviewRunInput),
              checkpointId,
            },
            0,
          );
        } else if (originalRun.kind === RunKind.WorkItemResolve) {
          await enqueueWorkItemResolve({
            threadId: id,
            runId: run.id,
            ...(originalRun.input as WorkItemResolveRunInput),
            checkpointId,
          });
        } else if (originalRun.kind === RunKind.TaskResolve) {
          await enqueueTaskResolve({
            threadId: id,
            runId: run.id,
            ...(originalRun.input as TaskResolveRunInput),
            checkpointId,
          });
        } else {
          throw new Error(
            `No retry-enqueue path wired for kind "${originalRun.kind}"`,
          );
        }
      } catch (err) {
        // Without this, a failed enqueue leaves `run` stuck QUEUED forever — no job means nothing will ever pick it up.
        await runsService.failById(
          run.id,
          id,
          err instanceof Error ? err.message : 'Failed to enqueue retry',
        );
        throw err;
      }
    } else {
      execute(
        workflow,
        id,
        run.id,
        originalRun.input as never,
        secrets as never,
        checkpointId
          ? { mode: 'retry', fromCheckpointId: checkpointId }
          : { mode: 'fresh' },
      );
    }

    return run;
  },

  decide: async (
    id: string,
    runId: string,
    toolCallId: string,
    decision: 'approve' | 'reject',
    session?: Session,
  ) => {
    const thread = await threadsDal.findById(id);
    if (!thread) throw errors.threads.notFound();
    if (thread.archived_at) throw errors.threads.archived();

    const originalRun = await runsDal.findById(runId);
    if (!originalRun) throw errors.runs.notFound();

    const workflow = workflowsService.forKind(originalRun.kind);
    if (
      !workflow.interruptible ||
      originalRun.status !== RunStatus.INTERRUPTED
    ) {
      throw errors.runs.notInterrupted();
    }

    const secrets = await resolveSecrets(session);
    workflow.validateInput?.(originalRun.input as never, secrets as never);

    // Locked so a double-click or duplicate request can't pass hasActive before this insert commits.
    const run = await withLock(`thread-active-run:${id}`, async () => {
      if (await runsDal.hasActive(id)) throw errors.runs.alreadyRunning();

      return runsDal.insert({
        thread_id: id,
        kind: originalRun.kind,
        input: originalRun.input,
        resume_payload: { toolCallId, decision },
      });
    });

    publishThreadUpdate(id, RunStatus.QUEUED);

    execute(
      workflow,
      id,
      run.id,
      originalRun.input as never,
      secrets as never,
      { mode: 'resume', decision: { toolCallId, decision } },
    );

    return run;
  },

  abort: (runId: string) => {
    const controller = abortControllers.get(runId);
    if (!controller) throw errors.runs.notActive();
    controller.abort();
  },

  // Kept separate from abort() since abort() also has an internal caller (threadsService.delete()) that skips this ownership check.
  requestAbort: async (id: string, runId: string) => {
    await runsService.getById(runId, id); // confirms runId belongs to thread id
    runsService.abort(runId);
  },

  abortAll: () => {
    for (const controller of abortControllers.values()) {
      controller.abort();
    }
  },

  stream(runId: string): AsyncGenerator<RunEvent> {
    return runPubSub.stream(runId);
  },

  getStatus(runId: string): Promise<RunStatus | null> {
    return runPubSub.getStatus(runId);
  },

  getError(runId: string): Promise<string | null> {
    return runPubSub.getError(runId);
  },

  getById: async (runId: string, id: string) => {
    const run = await runsDal.findById(runId);
    if (!run || run.thread_id !== id) throw errors.runs.notFound();
    return run;
  },

  list: (id: string) => runsDal.getByThread(id),

  countByThread: (id: string) => runsDal.countByThread(id),

  supersedeById: async (runId: string, id: string) => {
    const superseded = await runsDal.supersedeById(runId);

    if (!superseded) {
      // ideally it should never happen
      logger.error(
        { runId, id },
        '[runs] attempted to supersede a run that was not QUEUED — left untouched to avoid losing a real run record',
      );
      return;
    }

    const thread = await threadsDal.findByIdWithStatus(id);
    if (thread) broadcast({ type: 'thread:upserted', payload: thread });
  },

  failById: async (runId: string, id: string, error: string) => {
    await runsDal.update({ status: RunStatus.FAILED, error }, runId);
    await publishThreadUpdate(id, RunStatus.FAILED);
  },

  failPending: async (id: string) => {
    await runsDal.failPending(id);
    await publishThreadUpdate(id, RunStatus.FAILED);
  },

  failAllPending: async () => {
    const { threadIds, interruptedRuns, orphanedRuns } =
      await runsDal.failAllPending();
    await Promise.all(
      threadIds.map((id) => publishThreadUpdate(id, RunStatus.FAILED)),
    );
    return { interruptedRuns, orphanedRuns };
  },
};

async function publishThreadUpdate(
  id: string,
  status: RunStatus,
): Promise<void> {
  const thread = await threadsDal.findByIdWithStatus(id);
  if (thread)
    broadcast({
      type: 'thread:upserted',
      payload: { ...thread, latest_run_status: status },
    });
}

async function execute<TInput, TSecrets>(
  workflow: Workflow<TInput, TSecrets>,
  id: string,
  runId: string,
  input: TInput,
  secrets: TSecrets,
  mode: RunMode,
  queueWaitMs?: number,
): Promise<void> {
  if (abortControllers.has(runId)) return;

  const runTimeout = RUN_TIMEOUT_BY_KIND[workflow.kind];
  const controller = new AbortController();
  abortControllers.set(runId, controller);
  const timeoutId = setTimeout(
    () =>
      controller.abort(
        new DOMException(runTimeoutReason(runTimeout), 'TimeoutError'),
      ),
    runTimeout,
  );

  try {
    await runPubSub.init(runId);
    const runningRun = await runsDal.update(
      { status: RunStatus.RUNNING },
      runId,
    );
    await publishThreadUpdate(id, RunStatus.RUNNING);

    const accumulated: RunEvent[] =
      queueWaitMs === undefined
        ? []
        : [
            {
              event: 'queue_wait',
              data: { waitMs: queueWaitMs, timestamp: Date.now() },
            },
          ];
    const ctx: RunContext = { id, runId, signal: controller.signal, ...mode };

    try {
      await accumulateStream(
        runId,
        workflow.stream(input, ctx, secrets),
        accumulated,
        controller,
      );

      // An 'interrupt' event means paused — humanApprovalMiddleware ends the turn right after emitting it, so no workflow-specific detection is needed.
      const status = accumulated.some((e) => e.event === 'interrupt')
        ? RunStatus.INTERRUPTED
        : RunStatus.COMPLETED;

      await runsDal.update({ status, events: accumulated }, runId);
      recordRunSummary(runId, runningRun?.started_at, accumulated, true);
      await runPubSub.finish(runId, status);
      await publishThreadUpdate(id, status);
    } catch (err: unknown) {
      const timedOut =
        controller.signal.aborted &&
        (controller.signal.reason as DOMException)?.name === 'TimeoutError';
      const generationLoop =
        controller.signal.aborted &&
        (controller.signal.reason as DOMException)?.name ===
          'GenerationLoopError';
      const isRunAborted = err instanceof RunAbortedError;
      const isAbort =
        timedOut ||
        generationLoop ||
        isRunAborted ||
        (err instanceof Error && err.name === 'AbortError') ||
        // execa's ExecaError uses isCanceled: true instead of name === 'AbortError' for a cancelSignal abort — treat both as an abort.
        (err as { isCanceled?: boolean })?.isCanceled === true;

      if (!isAbort) logger.error({ err, runId, id }, 'Workflow error');

      const error = timedOut
        ? runTimeoutReason(runTimeout)
        : generationLoop
          ? (controller.signal.reason as DOMException).message
          : isRunAborted
            ? err.message
            : isAbort
              ? 'Aborted'
              : err instanceof Error
                ? err.message
                : 'Unknown error';
      await runsDal.update(
        { status: RunStatus.FAILED, error, events: accumulated },
        runId,
      );
      const errorKind: ErrorKind = timedOut
        ? 'timeout'
        : generationLoop
          ? 'generationLoop'
          : isRunAborted
            ? 'guardAbort'
            : isAbort
              ? 'manualAbort'
              : 'modelError';
      recordRunSummary(
        runId,
        runningRun?.started_at,
        accumulated,
        false,
        errorKind,
      );
      await runPubSub.finish(runId, RunStatus.FAILED, error);
      await publishThreadUpdate(id, RunStatus.FAILED);

      await workflow.onFailure?.(input, ctx, isAbort, timedOut);
    }
  } finally {
    clearTimeout(timeoutId);
    abortControllers.delete(runId);
  }
}

async function accumulateStream(
  runId: string,
  stream: AsyncGenerator<RunEvent>,
  accumulated: RunEvent[],
  controller: AbortController,
): Promise<void> {
  // A sub-agent's own conversation streams concurrently with the main agent's, interleaving in this one combined stream — so messages stay keyed by id and out of `accumulated` entirely until the stream ends, instead of a single shared buffer that would blend unrelated ones together.
  const messages = new Map<
    string,
    { data: MessageEvent['data']; afterIndex: number }
  >();
  let lastProgressAt = Date.now();

  try {
    for await (const event of stream) {
      await runPubSub.publish(runId, event);

      if (event.event === 'tool_input') lastProgressAt = Date.now();

      if (event.event === 'message') {
        const id = event.data.id;
        let message = messages.get(id);
        if (!message) {
          message = {
            data: {
              id,
              content: '',
              reasoningContent: '',
              ...(event.data.subagentId && {
                subagentId: event.data.subagentId,
              }),
            },
            afterIndex: accumulated.length,
          };
          messages.set(id, message);
        }
        message.data.content += event.data.content;
        message.data.reasoningContent += event.data.reasoningContent;

        // A subagent's own spawn_subagent call already polices its own loop — this only needs to catch a main-agent one.
        // Cheap gate — a normal turn never pays for the repeat scan.
        if (
          !message.data.subagentId &&
          Date.now() - lastProgressAt >= IDLE_TOOL_CALL_MS
        ) {
          // A loop can play out entirely inside the reasoning stream, so both fields need the same scan.
          const repeated =
            findRepeatedText(message.data.content, REPEATED_TEXT_THRESHOLD) ??
            findRepeatedText(
              message.data.reasoningContent,
              REPEATED_TEXT_THRESHOLD,
            );
          if (repeated) {
            controller.abort(
              new DOMException(
                generationLoopReason(repeated),
                'GenerationLoopError',
              ),
            );
          }
        }
      } else if (event.event === 'model_retry') {
        // A fresh attempt starts its own idle clock — otherwise it inherits however long the retries already took.
        lastProgressAt = Date.now();
        // Discard the failed attempt's partial text — only a successful attempt's message should end up in history. Never having reached `accumulated` yet, there's nothing there to undo.
        messages.delete(event.data.id);
        const last = accumulated[accumulated.length - 1];

        // simply replaces the earlier one instead of accumulating separate entries
        if (last?.event === 'model_retry' && last.data.id === event.data.id) {
          accumulated[accumulated.length - 1] = event;
        } else {
          accumulated.push(event);
        }
      } else {
        accumulated.push(event);
      }
    }
  } finally {
    // Inserted back at each message's own start position, in original relative order — descending so an earlier insertion doesn't shift a later message's target index. A tool-calls-only turn leaves content and reasoningContent both empty — nothing worth persisting.
    const finished = [...messages.values()]
      .filter((m) => m.data.content || m.data.reasoningContent)
      .sort((a, b) => b.afterIndex - a.afterIndex);

    for (const { data, afterIndex } of finished) {
      accumulated.splice(afterIndex, 0, { event: 'message', data });
    }
  }
}
