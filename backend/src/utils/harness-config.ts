import micromatch from 'micromatch';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  HarnessConfig,
  HarnessConfigStatus,
  ParsedHarnessConfig,
} from '#types.js';

import { fetchRepoFile } from './gitlab.js';
import { logger } from './logger.js';

const HARNESS_CONFIG_PATH = '.harness.yml';
const HARNESS_CONFIG_VERSION = 1;

const instructionDocSchema = z.object({
  path: z.string(),
  match: z.array(z.string()).optional(),
});

export const harnessConfigSchema = z.object({
  version: z.number().int().optional().default(1),
  // Each doc has a path and, optionally, `match` globs. A doc with no `match`
  // is always attached; a doc with `match` is attached only when the MR changes
  // a file matching one of the globs.
  mr_review_instructions: z.array(instructionDocSchema).optional().default([]),
  work_item_resolve_instructions: z
    .array(instructionDocSchema)
    .optional()
    .default([]),
  exclude_branches: z
    .object({
      // Branch-name globs (micromatch): `*` within a segment, `**` across `/`.
      source: z.array(z.string()).optional().default([]),
      target: z.array(z.string()).optional().default([]),
    })
    .optional()
    .default({ source: [], target: [] }),
  // Only review an MR once the bot is one of its reviewers; false reviews as before.
  mr_review_requires_harness_reviewer: z.boolean().optional().default(false),
});

/**
 * Fetch, parse and validate `.harness.yml` from the repo's default branch.
 * Never throws: fetch/parse/version problems are reported via `status` so the
 * webhook route can gate branches and the workflow can carry on without
 * instructions rather than failing the whole review.
 */
export async function parseHarnessYml(
  projectId: string,
): Promise<ParsedHarnessConfig> {
  let raw: string | null;
  try {
    raw = await fetchRepoFile(projectId, HARNESS_CONFIG_PATH);
  } catch (err) {
    logger.error({ err }, `Failed to fetch ${HARNESS_CONFIG_PATH}`);
    return { parsed: null, status: HarnessConfigStatus.Invalid };
  }

  if (raw === null)
    return { parsed: null, status: HarnessConfigStatus.Missing };

  let cfg: HarnessConfig;
  try {
    cfg = harnessConfigSchema.parse(parse(raw));
  } catch (err) {
    logger.error({ err }, `Invalid ${HARNESS_CONFIG_PATH}`);
    return { parsed: null, status: HarnessConfigStatus.Invalid };
  }

  if (cfg.version < 1 || cfg.version > HARNESS_CONFIG_VERSION) {
    logger.warn(
      `${HARNESS_CONFIG_PATH} version ${cfg.version} is not supported (supported: 1–${HARNESS_CONFIG_VERSION}). Skipping instructions.`,
    );
    return { parsed: null, status: HarnessConfigStatus.Invalid };
  }

  return { parsed: cfg, status: HarnessConfigStatus.Ok };
}

/**
 * Whether an MR should be reviewed based on its branches.
 * Returns false when the source or target branch matches an exclude_branches
 * glob (micromatch). config === null → always review.
 */
export function shouldReviewBranch(
  config: HarnessConfig | null,
  sourceBranch: string,
  targetBranch: string,
): boolean {
  const excl = config?.exclude_branches;
  if (!excl) return true;
  if (excl.source.length && micromatch.isMatch(sourceBranch, excl.source))
    return false;
  if (excl.target.length && micromatch.isMatch(targetBranch, excl.target))
    return false;
  return true;
}
