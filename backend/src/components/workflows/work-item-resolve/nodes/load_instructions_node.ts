import { InstructionStatus } from '#types.js';

import { resolveInstructionDocs } from '#components/workflows/instructions.js';
import { createLoadInstructionsNode } from '#components/workflows/nodes/load_instructions_node.js';
import type { WorkflowState } from '#components/workflows/work-item-resolve/state.js';

import { upsertIssueNote } from '#utils/gitlab.js';
import { workItemResolveNote } from '#utils/notes.js';

export const loadInstructionsNode = createLoadInstructionsNode<WorkflowState>({
  getDocs: (parsed) => parsed.work_item_resolve_instructions,

  resolveContent: async (docs, state, config) => {
    const { defaultBranch } = state;
    const worktreePath = config.configurable?.worktreePath as string;
    const { signal } = config;

    const { content, error } = await resolveInstructionDocs(
      worktreePath,
      defaultBranch,
      docs,
      signal,
    );
    return { content, status: InstructionStatus.LoadedAll, error };
  },

  postNote: async (state, config, status) => {
    const { projectPath, issueIid, model, noteId } = state;
    const threadId = config.configurable?.thread_id as string | undefined;
    await upsertIssueNote(
      projectPath,
      issueIid,
      workItemResolveNote.working(model, status, threadId),
      noteId!,
    );
  },
});
