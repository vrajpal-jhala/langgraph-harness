import micromatch from 'micromatch';
import { parse } from 'yaml';
import { z } from 'zod';

import {
  type GitHost,
  HarnessConfig,
  HarnessConfigStatus,
  ParsedHarnessConfig,
} from '#types.js';

import { logger } from './logger.js';

const HARNESS_CONFIG_PATH = '.harness.yml';
const HARNESS_CONFIG_VERSION = 2;
const HARNESS_CONFIG_DOCS_URL =
  'https://vrajpal-jhala.github.io/langgraph-harness/guide/configuration';

const branchGlobs = z.array(z.string()).default([]);

// Strict throughout, so a typo or a leftover version 1 key fails with its name instead of being silently dropped.
export const harnessConfigSchema = z.strictObject({
  version: z.literal(HARNESS_CONFIG_VERSION),
  review: z
    .strictObject({
      // A doc with `match` is attached only when the change touches a file matching one of its globs; without it, always.
      instructions: z
        .array(
          z.strictObject({
            path: z.string(),
            match: z.array(z.string()).optional(),
          }),
        )
        .default([]),
      exclude_branches: z
        .strictObject({
          // Branch-name globs (micromatch): `*` within a segment, `**` across `/`.
          source: branchGlobs,
          target: branchGlobs,
        })
        .prefault({}),
      // Only review once the bot is one of the reviewers; false reviews every change.
      requires_reviewer: z.boolean().default(false),
    })
    .prefault({}),
  // Issue runs and tasks: anything that writes code.
  resolve: z
    .strictObject({
      instructions: z.array(z.strictObject({ path: z.string() })).default([]),
    })
    .prefault({}),
});

/**
 * Fetch, parse and validate `.harness.yml` from the repo's default branch.
 * Never throws: fetch/parse/version problems are reported via `status` so the
 * webhook route can gate branches and the workflow can carry on without
 * instructions rather than failing the whole review.
 */
export async function parseHarnessYml(
  host: GitHost,
  projectPath: string,
): Promise<ParsedHarnessConfig> {
  let raw: string | null;
  try {
    raw = await host.fetchRepoFile(projectPath, HARNESS_CONFIG_PATH);
  } catch (err) {
    logger.error({ err }, `Failed to fetch ${HARNESS_CONFIG_PATH}`);
    return {
      parsed: null,
      status: HarnessConfigStatus.Invalid,
      error: `Couldn't fetch ${HARNESS_CONFIG_PATH}.`,
    };
  }

  if (raw === null)
    return { parsed: null, status: HarnessConfigStatus.Missing };

  let document: unknown;
  try {
    document = parse(raw);
  } catch (err) {
    logger.error({ err }, `Invalid ${HARNESS_CONFIG_PATH}`);
    return {
      parsed: null,
      status: HarnessConfigStatus.Invalid,
      error: `${HARNESS_CONFIG_PATH} isn't valid YAML.`,
    };
  }

  // Checked before the schema so an older file gets this, not an error per renamed key. A file without `version` predates it, so it's version 1.
  const version = (document as { version?: unknown } | null)?.version ?? 1;
  if (version !== HARNESS_CONFIG_VERSION) {
    const error = `${HARNESS_CONFIG_PATH} version ${String(version)} is no longer supported — update it to version ${HARNESS_CONFIG_VERSION}: ${HARNESS_CONFIG_DOCS_URL}`;
    logger.warn(error);
    return { parsed: null, status: HarnessConfigStatus.Invalid, error };
  }

  const result = harnessConfigSchema.safeParse(document);
  if (!result.success) {
    const error = `Invalid ${HARNESS_CONFIG_PATH}: ${z.prettifyError(result.error)}`;
    logger.error(error);
    return { parsed: null, status: HarnessConfigStatus.Invalid, error };
  }
  const cfg = result.data;

  return { parsed: cfg, status: HarnessConfigStatus.Ok };
}

/**
 * Whether a merge or pull request should be reviewed based on its branches.
 * Returns false when the source or target branch matches an exclude_branches
 * glob (micromatch). config === null → always review.
 */
export function shouldReviewBranch(
  config: HarnessConfig | null,
  sourceBranch: string,
  targetBranch: string,
): boolean {
  const excl = config?.review.exclude_branches;
  if (!excl) return true;
  if (excl.source.length && micromatch.isMatch(sourceBranch, excl.source))
    return false;
  if (excl.target.length && micromatch.isMatch(targetBranch, excl.target))
    return false;
  return true;
}
