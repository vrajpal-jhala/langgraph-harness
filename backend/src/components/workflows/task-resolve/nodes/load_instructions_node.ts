import { InstructionStatus } from '#types.js';

import { resolveInstructionDocs } from '#components/workflows/instructions.js';
import { createLoadInstructionsNode } from '#components/workflows/nodes/load_instructions_node.js';
import type { TaskResolveState } from '#components/workflows/task-resolve/state.js';

// No postNote: on a first run the MR doesn't exist yet, so there's no note to update — the completion note is posted after the MR is opened.
export const loadInstructionsNode =
  createLoadInstructionsNode<TaskResolveState>({
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
  });
