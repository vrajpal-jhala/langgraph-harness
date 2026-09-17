import { END, START, StateGraph } from '@langchain/langgraph';

import {
  type MrReviewRunInput,
  type RunContext,
  type RunEvent,
  RunStep,
  type Workflow,
  WorkflowNode,
} from '#types.js';
import { InstructionStatus, RunKind } from '#types.js';

import { repositoriesManager } from '#components/repositories/manager.js';
import { runsService } from '#components/runs/service.js';
import { threadsDal } from '#components/threads/dal.js';
import { threadsService } from '#components/threads/service.js';
import { translateRunStream } from '#components/workflows/stream-translator.js';
import { agentNode } from './nodes/agent_node.js';
import { loadInstructionsNode } from './nodes/load_instructions_node.js';
import { notifyReviewStatusNode } from './nodes/notify_review_status_node.js';
import { enqueueMrReview, mrReviewQueue } from './queue.js';
import { WorkflowState, workflowState } from './state.js';
import { tools } from './tools.js';

import { isAdmin } from '#utils/auth.js';
import { config } from '#utils/config.js';
import { checkpointer } from '#utils/db.js';
import { errors } from '#utils/errors.js';
import { upsertMrNote } from '#utils/gitlab.js';
import { logger } from '#utils/logger.js';
import { createLoop } from '#utils/loop.js';
import { mrNote } from '#utils/notes.js';

type CompiledWorkflow = Awaited<ReturnType<typeof buildWorkflow>>;

const KNOWN_LC_SOURCES = new Set([
  'summarization',
  'comment_critic',
  'extract_project_memory',
]);

const WORKFLOW_NAME = 'MR Review';
const WORKFLOW_DESCRIPTION =
  'Reviews GitLab merge requests and posts feedback as comments.';

async function buildWorkflow() {
  return new StateGraph(workflowState)
    .addNode(WorkflowNode.NotifyReviewStart, notifyReviewStatusNode)
    .addNode(WorkflowNode.LoadInstructions, loadInstructionsNode)
    .addNode(WorkflowNode.Agent, agentNode)
    .addNode(WorkflowNode.NotifyReviewEnd, notifyReviewStatusNode)
    .addEdge(START, WorkflowNode.NotifyReviewStart)
    .addEdge(WorkflowNode.NotifyReviewStart, WorkflowNode.LoadInstructions)
    .addEdge(WorkflowNode.LoadInstructions, WorkflowNode.Agent)
    .addEdge(WorkflowNode.Agent, WorkflowNode.NotifyReviewEnd)
    .addEdge(WorkflowNode.NotifyReviewEnd, END)
    .compile({
      name: WORKFLOW_NAME,
      description: WORKFLOW_DESCRIPTION,
      checkpointer,
    });
}

let compiledWorkflow: CompiledWorkflow | null = null;

async function sweepStaleThreads() {
  const staleIds = await threadsDal.findStaleThreadIds(
    RunKind.MrReview,
    config.mrReview.archivalRetentionMs,
  );
  await threadsService.sweepStale(staleIds, 'mr-review-archival');
}

const archivalLoop = createLoop(
  sweepStaleThreads,
  config.mrReview.archivalCleanupIntervalMs,
);

async function getNoteContext(threadId: string) {
  if (!compiledWorkflow) throw new Error('Workflow not initialized');
  const state = await compiledWorkflow.getState({
    configurable: { thread_id: threadId },
  });
  const values = state?.values as WorkflowState;
  return {
    noteId: values?.noteId ?? null,
    instructionStatus:
      values.config?.instructions?.status ?? InstructionStatus.Loading,
  };
}

export const mrReviewWorkflow: Workflow<MrReviewRunInput> = {
  id: 'mr-review',
  kind: RunKind.MrReview,
  name: WORKFLOW_NAME,
  description: WORKFLOW_DESCRIPTION,
  checkAccess: (_thread, session, action) => {
    if (action === 'mutate' && !isAdmin(session.username)) {
      throw errors.runs.forbidden();
    }
  },
  startMode: 'queued',
  interruptible: false,
  cancelPendingRun: async (run) => {
    if (!mrReviewQueue) return;
    const { query } = run.input as MrReviewRunInput;
    const jobId = `review:${query.projectId}:${query.mrIid}`;
    const job = await mrReviewQueue.getJob(jobId);
    if (job?.data.runId === run.id) await job.remove().catch(() => {});
  },
  recoverOrphanedRun: async (run) => {
    const { query, model, reasoning, config } = run.input as MrReviewRunInput;
    const newRun = await runsService.create(run.thread_id, RunKind.MrReview, {
      kind: RunKind.MrReview,
      query,
      model,
      reasoning,
      config,
    });
    await enqueueMrReview(
      `review:${query.projectId}:${query.mrIid}`,
      {
        threadId: run.thread_id,
        runId: newRun.id,
        kind: RunKind.MrReview,
        query,
        model,
        reasoning,
        config,
      },
      0,
    );
  },
  init: async () => {
    await tools.init();
    compiledWorkflow = await buildWorkflow();
    archivalLoop.start();
  },
  cleanup: async () => {
    archivalLoop.stop();
    await tools.cleanup();
  },
  // Static per compiled graph (not per run) — safe to compute on every request.
  getGraphMermaid: async () => {
    if (!compiledWorkflow) throw new Error('Workflow not initialized');
    const graph = await compiledWorkflow.getGraphAsync();
    return graph.drawMermaid();
  },
  stream: async function* (
    input: MrReviewRunInput,
    ctx: RunContext,
  ): AsyncGenerator<RunEvent> {
    if (!compiledWorkflow) throw new Error('Workflow not initialized');

    const { query, model, reasoning, config: harnessConfig } = input;
    const { id: threadId, runId, signal } = ctx;
    // mr-review is never interruptible, so 'resume' never reaches here — only fresh vs. retry-from-checkpoint.
    const fromCheckpointId =
      ctx.mode === 'retry' ? ctx.fromCheckpointId : undefined;

    // a retry of a run persisted before sourceBranch existed can't get a worktree
    if (!query.sourceBranch) {
      throw new Error(
        'No sourceBranch to retry with — trigger a fresh review instead.',
      );
    }

    const stepId = crypto.randomUUID();
    let error = '';
    let errorRetries: number | undefined;
    let worktree: Awaited<
      ReturnType<typeof repositoriesManager.acquireWorktree>
    > | null = null;

    yield {
      event: 'run_step_start',
      data: {
        id: stepId,
        step: RunStep.PrepareWorktree,
        timestamp: Date.now(),
      },
    };

    try {
      worktree = await repositoriesManager.acquireWorktree({
        repo: query.projectId,
        entityType: 'mr',
        iid: query.mrIid,
        ref: query.sourceBranch,
        sha: query.sourceSha,
        signal,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      errorRetries = (err as { retries?: number } | undefined)?.retries;
      throw err;
    } finally {
      yield {
        event: 'run_step_end',
        data: {
          id: stepId,
          step: RunStep.PrepareWorktree,
          repo: query.projectId,
          ref: query.sourceBranch,
          cloned: error || !worktree ? false : worktree.cloned,
          revived: error || !worktree ? false : worktree.revived,
          error,
          retries: worktree?.retries ?? errorRetries ?? 0,
          maxRetries: config.repositories.worktreeAcquireMaxRetries,
          timestamp: Date.now(),
        },
      };
    }

    try {
      const raw = await compiledWorkflow.stream(
        fromCheckpointId
          ? null
          : {
              query,
              reasoning,
              model,
              messages: [],
              config: {
                ...harnessConfig,
                instructions: {
                  status: InstructionStatus.Loading,
                  content: '',
                },
              },
            },
        {
          configurable: {
            thread_id: threadId,
            run_id: runId,
            worktreePath: worktree.path,
            revived: worktree.revived,
            ...(fromCheckpointId && { checkpoint_id: fromCheckpointId }),
          },
          streamMode: ['messages', 'tools', 'custom', 'checkpoints'],
          signal,
        },
      );

      yield* translateRunStream(raw, KNOWN_LC_SOURCES);
    } finally {
      await worktree
        .release()
        .catch((err) =>
          logger.error({ err, runId, id: threadId }, 'worktree release failed'),
        );
    }
  },

  onFailure: async (
    input: MrReviewRunInput,
    ctx: RunContext,
    isAbort: boolean,
    isTimeout: boolean,
  ): Promise<void> => {
    const { id, runId } = ctx;
    const { query, model } = input;

    const noteContext = await getNoteContext(id).catch((err) => {
      logger.error({ err, runId, id }, 'Error reading MR note context');
      return null;
    });

    if (!noteContext?.noteId) return;

    const { noteId, instructionStatus } = noteContext;
    const noteBody = isTimeout
      ? mrNote.timedOut(model, instructionStatus, id)
      : isAbort
        ? mrNote.aborted(model, instructionStatus, id)
        : mrNote.failed(model, instructionStatus, id);
    await upsertMrNote(query.projectId, query.mrIid, noteBody, noteId).catch(
      (err) => {
        logger.error({ err, runId, id, noteId }, 'Error updating MR note');
      },
    );
  },
};
