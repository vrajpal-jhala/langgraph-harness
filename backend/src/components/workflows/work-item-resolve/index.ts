import { END, START, StateGraph } from '@langchain/langgraph';

import type {
  RunContext,
  RunEvent,
  Workflow,
  WorkItemResolveRunInput,
} from '#types.js';
import {
  CompletionStatus,
  InstructionStatus,
  RunKind,
  RunStep,
  WorkflowNode,
} from '#types.js';

import { threadsDal } from '#components/threads/dal.js';
import { parseBranchType } from '#components/workflows/branch-naming.js';
import {
  createDraftCodeChangeRequest,
  updateCodeChangeRequest,
} from '#components/workflows/code-change-request.js';
import { migrateLegacyState } from '#components/workflows/legacy-state-migration.js';
import {
  createSandbox,
  reclaimSandboxWrites,
  resolveSandboxConfig,
} from '#components/workflows/sandbox.js';
import {
  abandonBranchIfEmpty,
  prepareSandboxedWorktree,
  pushBranch,
} from '#components/workflows/sandbox-worktree.js';
import { translateRunStream } from '#components/workflows/stream-translator.js';
import { tools } from '#components/workflows/tools.js';
import { deriveAndCheckoutBranch } from './issue-branch.js';
import { agentNode } from './nodes/agent_node.js';
import { assessCompletionNode } from './nodes/assess_completion_node.js';
import { loadInstructionsNode } from './nodes/load_instructions_node.js';
import { notifyIssueStatusNode } from './nodes/notify_issue_status_node.js';
import { workItemResolveQueue } from './queue.js';
import { type WorkflowState, workflowState } from './state.js';

import { isAdmin } from '#utils/auth.js';
import { config, toHostDataPath } from '#utils/config.js';
import { checkpointer } from '#utils/db.js';
import { errors } from '#utils/errors.js';
import { gitHosts } from '#utils/git-host.js';
import { logger } from '#utils/logger.js';
import {
  notDraftNotice,
  workItemResolveDescription,
  workItemResolveNote,
} from '#utils/notes.js';

type CompiledWorkflow = Awaited<ReturnType<typeof buildWorkflow>>;

const KNOWN_LC_SOURCES = new Set([
  'summarization',
  'reply_critic',
  'extract_project_memory',
]);

const WORKFLOW_NAME = 'Work Item Resolve';
const WORKFLOW_DESCRIPTION =
  'Implements an issue assigned to the bot and opens a draft with the change.';

// Fixed, sandbox-internal paths — decoupled from the real host paths so nothing inside the sandbox (e.g. `pwd`) can observe the host filesystem layout.
const SANDBOX_WORKTREE_DIR = '/workspace';
const SANDBOX_REPO_DIR = '/repo';

async function buildWorkflow() {
  return new StateGraph(workflowState)
    .addNode(WorkflowNode.NotifyIssueStart, notifyIssueStatusNode)
    .addNode(WorkflowNode.LoadInstructions, loadInstructionsNode)
    .addNode(WorkflowNode.Agent, agentNode)
    .addNode(WorkflowNode.AssessCompletion, assessCompletionNode)
    .addEdge(START, WorkflowNode.NotifyIssueStart)
    .addEdge(WorkflowNode.NotifyIssueStart, WorkflowNode.LoadInstructions)
    .addEdge(WorkflowNode.LoadInstructions, WorkflowNode.Agent)
    .addEdge(WorkflowNode.Agent, WorkflowNode.AssessCompletion)
    .addEdge(WorkflowNode.AssessCompletion, END)
    .compile({
      name: WORKFLOW_NAME,
      description: WORKFLOW_DESCRIPTION,
      checkpointer,
    });
}

let compiledWorkflow: CompiledWorkflow | null = null;

async function getNoteContext(threadId: string) {
  if (!compiledWorkflow) throw new Error('Workflow not initialized');
  const state = await compiledWorkflow.getState({
    configurable: { thread_id: threadId },
  });
  const values = state?.values as WorkflowState;
  return {
    statusCommentId: values?.statusCommentId ?? null,
    instructionStatus:
      values?.config?.instructions?.status ?? InstructionStatus.Loading,
    // AssessCompletion (the last node before END) always sets both together so they're never actually undefined.
    completionStatus: values?.completionStatus as CompletionStatus,
    completionSummary: values?.completionSummary as string,
    lastRunReplyCommentIds: values?.lastRunReplyCommentIds ?? [],
  };
}

export const workItemResolveWorkflow: Workflow<WorkItemResolveRunInput> = {
  id: 'work-item-resolve',
  kind: RunKind.WorkItemResolve,
  name: WORKFLOW_NAME,
  description: WORKFLOW_DESCRIPTION,
  checkAccess: (_thread, session, action) => {
    if (action === 'mutate' && !isAdmin(session)) {
      throw errors.runs.forbidden();
    }
  },
  startMode: 'queued',
  interruptible: false,
  cancelPendingRun: async (run) => {
    const job = await workItemResolveQueue?.getJob(run.id);
    await job?.remove().catch(() => {});
  },
  init: async () => {
    await tools.init();
    compiledWorkflow = await buildWorkflow();
  },
  cleanup: () => tools.cleanup(),
  // Static per compiled graph (not per run) — safe to compute on every request.
  getGraphMermaid: async () => {
    if (!compiledWorkflow) throw new Error('Workflow not initialized');
    const graph = await compiledWorkflow.getGraphAsync();
    return graph.drawMermaid();
  },
  stream: async function* (
    input: WorkItemResolveRunInput,
    ctx: RunContext,
  ): AsyncGenerator<RunEvent> {
    if (!compiledWorkflow) throw new Error('Workflow not initialized');

    const {
      provider,
      projectPath,
      issueNumber,
      defaultBranch,
      model,
      assignedBy,
      config: harnessConfig,
      issueKind,
    } = input;
    const { id: threadId, runId, signal } = ctx;
    const host = gitHosts[provider];
    const repo = host.repoKey(projectPath);
    let fromCheckpointId =
      ctx.mode === 'retry' ? ctx.fromCheckpointId : undefined;

    fromCheckpointId = await migrateLegacyState({
      graph: compiledWorkflow,
      threadId,
      checkpointId: fromCheckpointId,
      renames: {
        noteId: 'statusCommentId',
        lastRunReplyNoteIds: 'lastRunReplyCommentIds',
        issueIid: 'issueNumber',
      },
      nodeOrder: [
        WorkflowNode.NotifyIssueStart,
        WorkflowNode.LoadInstructions,
        WorkflowNode.Agent,
        WorkflowNode.AssessCompletion,
      ],
    });

    // Early read only to give the agent's MR tools a target — the authoritative codeChangeRequestNumber read/write stays the block below.
    const threadAtStart = await threadsDal.findById(threadId);
    const codeChangeRequestNumberAtStart =
      (threadAtStart?.metadata?.codeChangeRequestNumber as
        string | undefined) ?? null;

    const { branchName, issue } = yield* deriveAndCheckoutBranch({
      host,
      repo,
      issueNumber,
      projectPath,
      defaultBranch,
      model,
      issueKind,
      signal,
    });
    const issueTitle = issue.title;
    const issueDescription = issue.description;

    const { worktree, restoreGitLinks } = yield* prepareSandboxedWorktree({
      host,
      repo,
      entityType: 'issue',
      entityId: issueNumber,
      ref: branchName,
      sandboxRepoDir: SANDBOX_REPO_DIR,
      sandboxWorktreeDir: SANDBOX_WORKTREE_DIR,
      signal,
    });

    try {
      const issueType = parseBranchType(branchName);
      if (!issueType) {
        throw new Error(
          `Could not recover issue type from branch name "${branchName}"`,
        );
      }

      const { image } = await resolveSandboxConfig(worktree.path);

      try {
        const sandboxStepId = crypto.randomUUID();
        let sandboxError = '';
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | null = null;

        yield {
          event: 'run_step_start',
          data: {
            id: sandboxStepId,
            step: RunStep.CreateSandbox,
            image,
            timestamp: Date.now(),
          },
        };
        try {
          sandbox = await createSandbox({
            image,
            volumes: [
              {
                name: 'worktree',
                hostPath: toHostDataPath(worktree.path),
                mountPath: SANDBOX_WORKTREE_DIR,
              },
              {
                name: 'repo',
                hostPath: toHostDataPath(worktree.repoPath),
                mountPath: SANDBOX_REPO_DIR,
              },
            ],
            signal,
          });
        } catch (err) {
          // OpenSandbox error text can include real host paths.
          logger.error({ err, runId, id: threadId }, 'Sandbox creation failed');
          sandboxError = 'Failed to create sandbox';
        } finally {
          yield {
            event: 'run_step_end',
            data: {
              id: sandboxStepId,
              step: RunStep.CreateSandbox,
              sandboxId: sandbox?.id ?? '',
              error: sandboxError,
              timestamp: Date.now(),
            },
          };
        }

        if (sandboxError || !sandbox) {
          throw new Error(sandboxError || 'sandbox create failed');
        }

        try {
          const raw = await compiledWorkflow.stream(
            fromCheckpointId
              ? null
              : {
                  projectPath,
                  issueNumber,
                  issueTitle,
                  issueDescription,
                  issueType,
                  defaultBranch,
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
                ...(fromCheckpointId && { checkpoint_id: fromCheckpointId }),
                sandbox,
                workingDirectory: SANDBOX_WORKTREE_DIR,
                worktreePath: worktree.path,
                codeChangeRequestNumber: codeChangeRequestNumberAtStart,
                host,
              },
              streamMode: ['messages', 'tools', 'custom', 'checkpoints'],
              signal,
            },
          );

          yield* translateRunStream(raw, KNOWN_LC_SOURCES);
        } finally {
          const killStepId = crypto.randomUUID();
          let killError = '';
          yield {
            event: 'run_step_start',
            data: {
              id: killStepId,
              step: RunStep.KillSandbox,
              sandboxId: sandbox.id,
              timestamp: Date.now(),
            },
          };
          try {
            await reclaimSandboxWrites(sandbox, [
              SANDBOX_WORKTREE_DIR,
              SANDBOX_REPO_DIR,
            ]);
            await sandbox.sandboxes.deleteSandbox(sandbox.id);
          } catch (err) {
            killError = err instanceof Error ? err.message : String(err);
          } finally {
            yield {
              event: 'run_step_end',
              data: {
                id: killStepId,
                step: RunStep.KillSandbox,
                error: killError,
                timestamp: Date.now(),
              },
            };
          }
        }
      } finally {
        await restoreGitLinks();
      }

      // A second open MR for the same branch pair is rejected on both providers, so reuse one if this thread already made it.
      const thread = await threadsDal.findById(threadId);
      const existingCodeChangeRequestNumber = thread?.metadata
        ?.codeChangeRequestNumber as string | undefined;
      const existingCodeChangeRequestUrl = thread?.metadata
        ?.codeChangeRequestUrl as string | undefined;
      let openedAsDraft =
        thread?.metadata?.codeChangeRequestOpenedAsDraft === true;

      // An existing MR already means an earlier run had changes — never abandon that branch.
      const hasChanges =
        !!existingCodeChangeRequestNumber ||
        (yield* abandonBranchIfEmpty({
          repo,
          worktreeRepoPath: worktree.repoPath,
          branchName,
          defaultBranch,
          entityType: 'issue',
          entityId: issueNumber,
          signal,
        }));

      let codeChangeRequestNumber = existingCodeChangeRequestNumber ?? '';
      let codeChangeRequestUrl = existingCodeChangeRequestUrl ?? '';

      if (hasChanges) {
        yield* pushBranch({
          repo,
          worktreeRepoPath: worktree.repoPath,
          branchName,
          expectedSha: worktree.preFetchSha,
          signal,
        });

        const created = yield* createDraftCodeChangeRequest({
          host,
          projectPath,
          sourceBranch: branchName,
          targetBranch: defaultBranch,
          title: issueTitle,
          description: `#${issueNumber}`,
          reviewerUsername: existingCodeChangeRequestNumber
            ? null
            : assignedBy || null,
          existingCodeChangeRequestNumber,
          existingCodeChangeRequestUrl,
          mockNumber: `mock-code-change-request-${issueNumber}`,
          signal,
        });
        ({ codeChangeRequestNumber, codeChangeRequestUrl } = created);

        if (!existingCodeChangeRequestNumber) {
          openedAsDraft = created.draft;
          await threadsDal.mergeMetadata(threadId, {
            codeChangeRequestNumber: codeChangeRequestNumber,
            codeChangeRequestUrl: codeChangeRequestUrl,
            codeChangeRequestOpenedAsDraft: openedAsDraft,
          });
        }
      }

      try {
        const {
          statusCommentId,
          instructionStatus,
          completionStatus,
          completionSummary,
          lastRunReplyCommentIds,
        } = await getNoteContext(threadId);

        await threadsDal.mergeMetadata(threadId, {
          lastRunReplyCommentIds,
        });

        if (hasChanges) {
          yield* updateCodeChangeRequest({
            host,
            projectPath,
            codeChangeRequestNumber,
            description: workItemResolveDescription(host, issueNumber, {
              status: completionStatus,
              summary: completionSummary,
            }),
            ...(completionStatus === CompletionStatus.Done &&
              openedAsDraft && { draft: false }),
            completionStatus,
            completionSummary,
          });
        }

        const noteStepId = crypto.randomUUID();
        yield {
          event: 'run_step_start',
          data: {
            id: noteStepId,
            step: RunStep.NotifyIssueEnd,
            timestamp: Date.now(),
          },
        };
        let noteError = '';
        try {
          if (!config.mock.workflow && statusCommentId) {
            await host.upsertIssueComment(
              projectPath,
              issueNumber,
              hasChanges
                ? workItemResolveNote[completionStatus](
                    host,
                    model,
                    instructionStatus,
                    codeChangeRequestUrl,
                    completionSummary,
                    threadId,
                    // Done means ready for review either way, so the draft state only matters before that.
                    openedAsDraft || completionStatus === CompletionStatus.Done
                      ? undefined
                      : notDraftNotice(host),
                  )
                : workItemResolveNote.noChanges(
                    host,
                    model,
                    instructionStatus,
                    completionSummary,
                    threadId,
                  ),
              statusCommentId,
            );
          }
        } catch (err) {
          noteError = err instanceof Error ? err.message : String(err);
        } finally {
          yield {
            event: 'run_step_end',
            data: {
              id: noteStepId,
              step: RunStep.NotifyIssueEnd,
              error: noteError,
              timestamp: Date.now(),
            },
          };
        }
      } catch (err) {
        // Only getNoteContext/mergeMetadata can throw uncaught here — the two inner steps already capture their own errors.
        logger.error(
          { err, runId, id: threadId },
          'Error preparing MR/issue update after run',
        );
      }
    } catch (err) {
      // createBranch already pushed the branch empty; a run that fails before earning an MR would otherwise leave it dangling on the remote forever.
      const thread = await threadsDal.findById(threadId);
      if (!thread?.metadata?.codeChangeRequestNumber) {
        try {
          yield* abandonBranchIfEmpty({
            repo,
            worktreeRepoPath: worktree.repoPath,
            branchName,
            defaultBranch,
            entityType: 'issue',
            entityId: issueNumber,
            signal,
          });
        } catch (cleanupErr) {
          logger.error(
            { err: cleanupErr, runId, id: threadId },
            'Failed to abandon empty branch after run failure',
          );
        }
      }
      throw err;
    } finally {
      await worktree
        .release()
        .catch((err) =>
          logger.error({ err, runId, id: threadId }, 'worktree release failed'),
        );
    }
  },

  onFailure: async (
    input: WorkItemResolveRunInput,
    ctx: RunContext,
    isAbort: boolean,
    isTimeout: boolean,
  ): Promise<void> => {
    const { id, runId } = ctx;
    const { provider, projectPath, issueNumber, model } = input;
    const host = gitHosts[provider];

    const noteContext = await getNoteContext(id).catch((err) => {
      logger.error({ err, runId, id }, 'Error reading issue note context');
      return null;
    });

    if (!noteContext?.statusCommentId) return;

    const { statusCommentId, instructionStatus } = noteContext;
    const noteBody = isTimeout
      ? workItemResolveNote.timedOut(host, model, instructionStatus, id)
      : isAbort
        ? workItemResolveNote.aborted(host, model, instructionStatus, id)
        : workItemResolveNote.failed(host, model, instructionStatus, id);

    await host
      .upsertIssueComment(projectPath, issueNumber, noteBody, statusCommentId)
      .catch((err) => {
        logger.error(
          { err, runId, id, statusCommentId },
          'Error updating issue note',
        );
      });
  },
};
