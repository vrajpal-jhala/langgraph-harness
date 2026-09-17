import { createMiddleware } from 'langchain';

import type { WorkflowRuntime } from '#components/workflows/mr-review/state.js';

// A revived (branch-deleted) retry means local merge-base diffing can't recover a squash/fast-forward merge — swap to GitLab's diff_refs-based tools instead, since those survive branch deletion regardless of merge strategy.
export function dynamicDiffToolsMiddleware({
  localToolNames,
  gitlabToolNames,
}: {
  localToolNames: ReadonlySet<string>;
  gitlabToolNames: ReadonlySet<string>;
}) {
  return createMiddleware({
    name: 'DynamicDiffTools',
    wrapModelCall: (request, handler) => {
      const revived = (request.runtime as WorkflowRuntime).configurable
        ?.revived;
      const drop = revived ? localToolNames : gitlabToolNames;

      return handler({
        ...request,
        // All tools here are DynamicStructuredTool (ClientTool) instances, not the generic Record<string, unknown> ServerTool — .name is always a real string.
        tools: request.tools.filter(
          (t) => !drop.has((t as { name: string }).name),
        ),
      });
    },
  });
}
