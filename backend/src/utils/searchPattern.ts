import { type RawBuilder, sql, type SqlBool } from 'kysely';

import type { SearchMode } from '#types.js';

// `column` is always a fixed sql fragment chosen by our own code (e.g. sql.ref('threads.title') or
// sql`runs.events::text`), never user input — only `pattern` is a bound parameter.
export function matchExpression(
  column: RawBuilder<unknown>,
  pattern: string,
  mode: SearchMode = 'substring',
) {
  if (mode === 'regex') return sql<SqlBool>`${column} ~* ${pattern}`;
  if (mode === 'fuzzy')
    return sql<SqlBool>`similarity(${column}, ${pattern}) > 0.3`;

  // Literal %, _ shouldn't act as ILIKE wildcards when the caller means them literally.
  const escaped = pattern.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql<SqlBool>`${column} ILIKE ${'%' + escaped + '%'}`;
}
