import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

// The worktree holds MR-author-controlled content, so a symlink inside it could point out. Treat the model's path as repo-relative (it routinely passes "/src/x" meaning the repo root), then realpath-contain it so neither ".." nor a symlink escapes the worktree.
export async function resolveWithinWorktree(
  worktreePath: string,
  input: string,
): Promise<string> {
  const candidate =
    isAbsolute(input) && !input.startsWith(worktreePath)
      ? join(worktreePath, input.replace(/^\/+/, ''))
      : resolve(worktreePath, input);

  const rootReal = await realpath(worktreePath);
  let targetReal: string;
  try {
    targetReal = await realpath(candidate);
  } catch {
    // Leaf doesn't exist yet — realpath the parent instead, so a symlinked ancestor is still caught (ENOENT alone would be indistinguishable from "blocked").
    targetReal = join(await realpath(dirname(candidate)), basename(candidate));
  }

  const withinRoot =
    targetReal === rootReal || targetReal.startsWith(rootReal + sep);

  if (!withinRoot) {
    throw new Error(
      `Path "${input}" is outside the repository. Paths are relative to the repo root; call list_directory with "." to see the top level.`,
    );
  }

  return targetReal;
}
