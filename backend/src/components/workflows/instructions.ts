import { gitService } from '#components/repositories/service.js';

import { config as appConfig } from '#utils/config.js';

const TRUNCATION_NOTICE =
  '\n\n[... instructions truncated: exceeded configured size limit]';

/**
 * Concatenated content of a list of repo-hosted docs (read from `ref`).
 * Diff-based `match` filtering (mr-review only) happens before this — by the
 * time `docs` reaches here, it's already the exact list to attach.
 */
export async function resolveInstructionDocs(
  worktreePath: string,
  ref: string,
  docs: { path: string }[],
  signal?: AbortSignal,
): Promise<{ content: string; error: string }> {
  const sections: string[] = [];
  let error = '';
  for (const doc of docs) {
    const content = await gitService.showFile(
      worktreePath,
      ref,
      doc.path,
      signal,
    );
    if (content === null) {
      error += `${error ? '; ' : ''}Instruction doc not found: ${doc.path}`;
      continue;
    }
    sections.push(`--- ${doc.path} ---\n${content}`);
  }

  if (!sections.length) return { content: '', error };

  let body = sections.join('\n\n');
  const { maxChars } = appConfig.instructions;
  if (body.length > maxChars)
    body = body.slice(0, maxChars) + TRUNCATION_NOTICE;

  return { content: body, error };
}
