import type { RunInput, RunKind, Workflow } from '#types.js';
import { RunStatus } from '#types.js';

import { runsDal } from '#components/runs/dal.js';
import { chatWorkflow } from '#components/workflows/chat/index.js';
import { mrReviewWorkflow } from '#components/workflows/mr-review/index.js';
import { taskResolveWorkflow } from '#components/workflows/task-resolve/index.js';
import { workItemResolveWorkflow } from '#components/workflows/work-item-resolve/index.js';

import { errors } from '#utils/errors.js';

// Adding a workflow here is enough — init/shutdown pick it up automatically.
export const workflows = [
  chatWorkflow,
  mrReviewWorkflow,
  workItemResolveWorkflow,
  taskResolveWorkflow,
];

// IDLE has no RunStatus equivalent; the other two reuse RunStatus's own values.
const WorkflowStatus = {
  IDLE: 'idle',
  QUEUED: RunStatus.QUEUED,
  RUNNING: RunStatus.RUNNING,
} as const;

const buildWorkflow = async (workflow: (typeof workflows)[number]) => {
  const { byStatus, totalRuns, lastRunAt } = await runsDal.getStats(
    workflow.kind,
  );
  const activeRuns = (byStatus.running ?? 0) + (byStatus.queued ?? 0);
  const status = byStatus.running
    ? WorkflowStatus.RUNNING
    : byStatus.queued
      ? WorkflowStatus.QUEUED
      : WorkflowStatus.IDLE;

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status,
    totalRuns,
    activeRuns,
    lastRunAt,
    startMode: workflow.startMode,
    interruptible: workflow.interruptible,
  };
};

export const workflowsService = {
  forKind: (kind: RunKind): Workflow<RunInput, unknown> =>
    (workflows.find((w) => w.kind === kind) ??
      // Widened to unknown: TInput/TSecrets correlation with the run holds only by construction, not provably at compile time.
      mrReviewWorkflow) as unknown as Workflow<RunInput, unknown>,

  list: async () => Promise.all(workflows.map(buildWorkflow)),

  getById: async (id: string) => {
    const workflow = workflows.find((workflow) => workflow.id === id);
    if (!workflow) throw errors.workflows.notFound();
    return buildWorkflow(workflow);
  },

  getGraph: async (id: string) => {
    const workflow = workflows.find((workflow) => workflow.id === id);
    if (!workflow) throw errors.workflows.notFound();
    return { mermaid: await workflow.getGraphMermaid() };
  },
};
