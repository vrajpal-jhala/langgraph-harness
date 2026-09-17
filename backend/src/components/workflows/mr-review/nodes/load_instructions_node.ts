import micromatch from 'micromatch';

import { InstructionDoc, InstructionStatus } from '#types.js';

import { gitService } from '#components/repositories/service.js';
import { resolveInstructionDocs } from '#components/workflows/instructions.js';
import type { WorkflowState } from '#components/workflows/mr-review/state.js';
import { createLoadInstructionsNode } from '#components/workflows/nodes/load_instructions_node.js';

import { upsertMrNote } from '#utils/gitlab.js';
import { mrNote } from '#utils/notes.js';

export const loadInstructionsNode = createLoadInstructionsNode<WorkflowState>({
  getDocs: (parsed) => parsed.mr_review_instructions,

  resolveContent: async (docs: InstructionDoc[], state, config) => {
    const { query } = state;
    const worktreePath = config.configurable?.worktreePath as string;
    const { signal } = config;

    // File-scoped docs only apply when the MR changes matching files, so those
    // need the list of changed files. Skip the fetch when every doc is always-on.
    // If the fetch fails, keep changedFiles null so all docs are attached anyway
    // (fail-open — a broken diff lookup shouldn't drop instructions).
    let changedFiles: string[] | null = null;
    let status:
      | typeof InstructionStatus.LoadedAll
      | typeof InstructionStatus.LoadedFiltered = InstructionStatus.LoadedAll;

    const fileScoped = docs.some((doc) => !!doc.match?.length);
    if (fileScoped) {
      try {
        const base = await gitService.mergeBase(
          worktreePath,
          query.sourceBranch,
          query.targetBranch,
          signal,
        );
        changedFiles = await gitService.changedFilePaths(
          worktreePath,
          base,
          query.sourceBranch,
          signal,
        );
        status =
          changedFiles.length > 0
            ? InstructionStatus.LoadedFiltered
            : InstructionStatus.LoadedAll;
      } catch {
        // fail open: attach all docs below, as if unfiltered
      }
    }

    // Attach a doc if it's always-on, or (when the diff is known) if a changed
    // file matches one of its globs. changedFiles === null → attach all.
    const applicable = docs.filter((doc) => {
      if (!doc.match?.length) return true;
      if (changedFiles === null) return true;
      return changedFiles.some((file) => micromatch.isMatch(file, doc.match!));
    });

    const { content: body, error } = await resolveInstructionDocs(
      worktreePath,
      // default branch — an MR shouldn't be able to alter the guidelines it's reviewed against
      query.defaultBranch,
      applicable,
      signal,
    );

    if (!body) return { content: '', status, error };

    const content = [
      '## Repository Instructions',
      'The repository owner provided the following instruction documents. Apply them when reviewing this MR.',
      body,
    ].join('\n\n');

    return { content, status, error };
  },

  postNote: async (state, config, status) => {
    const { query, model, noteId } = state;
    const threadId = config.configurable?.thread_id as string | undefined;
    await upsertMrNote(
      query.projectId,
      query.mrIid,
      mrNote.inProgress(model, status, threadId),
      noteId!,
    );
  },
});
