import { END, START, StateGraph } from '@langchain/langgraph';

import type {
  RunContext,
  RunEvent,
  TaskResolveRunInput,
  Workflow,
} from '#types.js';
import {
  CompletionStatus,
  InstructionStatus,
  RunKind,
  RunStep,
  WorkflowNode,
} from '#types.js';

import { repositoriesManager } from '#components/repositories/manager.js';
import { threadsDal } from '#components/threads/dal.js';
import {
  classifyBranch,
  parseBranchType,
  slugify,
} from '#components/workflows/branch-naming.js';
import {
  createDraftMr,
  updateMr,
} from '#components/workflows/merge-request.js';
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
import { agentNode } from './nodes/agent_node.js';
import { assessCompletionNode } from './nodes/assess_completion_node.js';
import { loadInstructionsNode } from './nodes/load_instructions_node.js';
import { type TaskResolveState, taskResolveState } from './state.js';

import { isAdmin } from '#utils/auth.js';
import { config, toHostDataPath } from '#utils/config.js';
import { checkpointer } from '#utils/db.js';
import { errors } from '#utils/errors.js';
import { resolveGitlabUserId, upsertMrNote } from '#utils/gitlab.js';
import { logger } from '#utils/logger.js';
import { taskResolveDescription, taskResolveNote } from '#utils/notes.js';

type CompiledWorkflow = Awaited<ReturnType<typeof buildWorkflow>>;

const KNOWN_LC_SOURCES = new Set([
  'summarization',
  'reply_critic',
  'extract_project_memory',
]);

const WORKFLOW_NAME = 'Task Resolve';
const WORKFLOW_DESCRIPTION =
  'Runs a free-text instruction against a repository and opens a draft MR.';

// Fixed, sandbox-internal paths — decoupled from the real host paths so nothing inside the sandbox (e.g. `pwd`) can observe the host filesystem layout.
const SANDBOX_WORKTREE_DIR = '/workspace';
const SANDBOX_REPO_DIR = '/repo';

async function buildWorkflow() {
  return new StateGraph(taskResolveState)
    .addNode(WorkflowNode.LoadInstructions, loadInstructionsNode)
    .addNode(WorkflowNode.Agent, agentNode)
    .addNode(WorkflowNode.AssessCompletion, assessCompletionNode)
    .addEdge(START, WorkflowNode.LoadInstructions)
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

async function getCompletionContext(threadId: string) {
  if (!compiledWorkflow) throw new Error('Workflow not initialized');
  const state = await compiledWorkflow.getState({
    configurable: { thread_id: threadId },
  });
  const values = state?.values as TaskResolveState;
  return {
    instructionStatus:
      values?.config?.instructions?.status ?? InstructionStatus.Loading,
    // AssessCompletion (the last node before END) always sets both together so they're never actually undefined.
    completionStatus: values?.completionStatus as CompletionStatus,
    completionSummary: values?.completionSummary as string,
    lastRunReplyNoteIds: values?.lastRunReplyNoteIds ?? [],
  };
}

export const taskResolveWorkflow: Workflow<TaskResolveRunInput> = {
  id: 'task-resolve',
  kind: RunKind.TaskResolve,
  name: WORKFLOW_NAME,
  description: WORKFLOW_DESCRIPTION,
  checkAccess: (_thread, session, action) => {
    if (action === 'mutate' && !isAdmin(session.username)) {
      throw errors.runs.forbidden();
    }
  },
  startMode: 'queued',
  interruptible: false,
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
    input: TaskResolveRunInput,
    ctx: RunContext,
  ): AsyncGenerator<RunEvent> {
    if (!compiledWorkflow) throw new Error('Workflow not initialized');

    const {
      title,
      projectPath,
      prompt,
      defaultBranch,
      model,
      submittedBy,
      config: harnessConfig,
    } = input;
    const { id: threadId, runId, signal } = ctx;
    const fromCheckpointId =
      ctx.mode === 'retry' ? ctx.fromCheckpointId : undefined;

    const threadAtStart = await threadsDal.findById(threadId);
    const mrIidAtStart =
      (threadAtStart?.metadata?.mrIid as string | undefined) ?? null;
    // Set on the first run and reused after, so a follow-up amends the same branch rather than classifying and branching again.
    let branchName = threadAtStart?.metadata?.branchName as string | undefined;

    if (!branchName) {
      const { type, slug } = yield* classifyBranch({
        title,
        description: prompt,
        model,
      });
      // Thread id keeps branches from colliding across separate tasks on the same repo; work-item-resolve uses the issue iid in the same slot.
      branchName = `harness/${type}/${threadId.slice(0, 8)}-${slugify(slug)}`;

      const createBranchStepId = crypto.randomUUID();
      let createBranchError = '';
      yield {
        event: 'run_step_start',
        data: {
          id: createBranchStepId,
          step: RunStep.CreateBranch,
          branchName,
          timestamp: Date.now(),
        },
      };
      try {
        await repositoriesManager.createBranch({
          repo: projectPath,
          name: branchName,
          baseRef: defaultBranch,
          signal,
        });
        await threadsDal.mergeMetadata(threadId, { branchName });
      } catch (err) {
        createBranchError = err instanceof Error ? err.message : String(err);
        throw err;
      } finally {
        yield {
          event: 'run_step_end',
          data: {
            id: createBranchStepId,
            step: RunStep.CreateBranch,
            branchName,
            error: createBranchError,
            timestamp: Date.now(),
          },
        };
      }
    }

    const taskType = parseBranchType(branchName);
    if (!taskType) {
      throw new Error(
        `Could not recover task type from branch name "${branchName}"`,
      );
    }

    const { worktree, restoreGitLinks } = yield* prepareSandboxedWorktree({
      repo: projectPath,
      entityType: 'task',
      iid: threadId,
      ref: branchName,
      sandboxRepoDir: SANDBOX_REPO_DIR,
      sandboxWorktreeDir: SANDBOX_WORKTREE_DIR,
      signal,
    });

    try {
      const { image } = await resolveSandboxConfig(worktree.path);

      try {
        const sandboxStepId = crypto.randomUUID();
        let sandboxError = '';
        let sandbox: Awaited<ReturnType<typeof createSandbox>> | null = null;

        yield {
          event: 'run_step_start',
          data: {
            id: sandboxStepId,
            step: RunStep.SandboxCreate,
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
              step: RunStep.SandboxCreate,
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
                  title,
                  projectPath,
                  prompt,
                  taskType,
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
                mrIid: mrIidAtStart,
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
              step: RunStep.SandboxKill,
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
                step: RunStep.SandboxKill,
                error: killError,
                timestamp: Date.now(),
              },
            };
          }
        }
      } finally {
        await restoreGitLinks();
      }

      // GitLab rejects a second open MR for the same branch pair, so reuse one if this thread already made it.
      const existingThread = await threadsDal.findById(threadId);
      const existingMrIid = existingThread?.metadata?.mrIid as
        string | undefined;
      const existingMrUrl = existingThread?.metadata?.mrUrl as
        string | undefined;

      // An existing MR already means an earlier run had changes — never abandon that branch.
      const hasChanges =
        !!existingMrIid ||
        (yield* abandonBranchIfEmpty({
          repo: projectPath,
          worktreeRepoPath: worktree.repoPath,
          branchName,
          defaultBranch,
          entityType: 'task',
          iid: threadId,
          signal,
        }));

      let mrIid = existingMrIid ?? '';

      if (hasChanges) {
        yield* pushBranch({
          repo: projectPath,
          worktreeRepoPath: worktree.repoPath,
          branchName,
          expectedSha: worktree.preFetchSha,
          signal,
        });

        const reviewerId =
          !existingMrIid && submittedBy
            ? await resolveGitlabUserId(submittedBy, signal)
            : null;

        let mrUrl: string;
        ({ mrIid, mrUrl } = yield* createDraftMr({
          projectId: projectPath,
          sourceBranch: branchName,
          targetBranch: defaultBranch,
          title,
          description: taskResolveDescription(prompt),
          reviewerId,
          existingMrIid,
          existingMrUrl,
          mockIid: `mock-mr-iid-${threadId.slice(0, 8)}`,
        }));

        if (!existingMrIid) {
          await threadsDal.mergeMetadata(threadId, { mrIid, mrUrl });
        }
      }

      try {
        const {
          instructionStatus,
          completionStatus,
          completionSummary,
          lastRunReplyNoteIds,
        } = await getCompletionContext(threadId);

        await threadsDal.mergeMetadata(threadId, { lastRunReplyNoteIds });

        // An abandoned run has no issue or MR to report status to.
        if (hasChanges) {
          yield* updateMr({
            projectId: projectPath,
            mrIid,
            description: taskResolveDescription(prompt),
            ...(completionStatus === CompletionStatus.Done && {
              draft: false,
            }),
            completionStatus,
            completionSummary,
          });

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
            if (!config.mock.workflow) {
              // Status lives on the MR itself — there's no issue behind a task-resolve run.
              const noteId = existingThread?.metadata?.statusNoteId as
                number | undefined;
              const posted = await upsertMrNote(
                projectPath,
                mrIid,
                taskResolveNote[completionStatus](
                  model,
                  instructionStatus,
                  completionSummary,
                  threadId,
                ),
                noteId,
              );
              if (!noteId) {
                await threadsDal.mergeMetadata(threadId, {
                  statusNoteId: posted,
                });
              }
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
        }
      } catch (err) {
        // Only getCompletionContext/mergeMetadata can throw uncaught here — the two inner steps already capture their own errors.
        logger.error(
          { err, runId, id: threadId },
          'Error preparing MR update after run',
        );
      }
    } catch (err) {
      // createBranch already pushed the branch empty; a run that fails before earning an MR would otherwise leave it dangling on GitLab forever.
      const thread = await threadsDal.findById(threadId);
      if (!thread?.metadata?.mrIid) {
        try {
          yield* abandonBranchIfEmpty({
            repo: projectPath,
            worktreeRepoPath: worktree.repoPath,
            branchName,
            defaultBranch,
            entityType: 'task',
            iid: threadId,
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
    input: TaskResolveRunInput,
    ctx: RunContext,
    isAbort: boolean,
    isTimeout: boolean,
  ): Promise<void> => {
    const { id, runId } = ctx;
    const { projectPath, model } = input;

    const thread = await threadsDal.findById(id);
    const mrIid = thread?.metadata?.mrIid as string | undefined;
    // Nothing to report against until the first run has opened an MR.
    if (!mrIid) return;

    const noteId = thread?.metadata?.statusNoteId as number | undefined;
    const instructionStatus = InstructionStatus.Loading;
    const noteBody = isTimeout
      ? taskResolveNote.timedOut(model, instructionStatus, id)
      : isAbort
        ? taskResolveNote.aborted(model, instructionStatus, id)
        : taskResolveNote.failed(model, instructionStatus, id);

    await upsertMrNote(projectPath, mrIid, noteBody, noteId).catch((err) => {
      logger.error({ err, runId, id, noteId }, 'Error updating MR note');
    });
  },
};
