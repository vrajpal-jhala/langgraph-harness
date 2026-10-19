---
name: bump-npm-deps
description: >
  Bump npm dependencies across this repo's five package.json files (root,
  backend, frontend, services/monitoring, services/supermemory): apply SAFE
  (minor/patch) updates first, then take each MAJOR one at a time by reading its
  changelog and migration guide and grepping our usage, and end with a
  four-section report. Use when the user says "bump deps", "update npm
  dependencies", "run the dependency bump", or "/bump-npm-deps" — not for
  Docker image pins.
---

Follow the steps in order; don't batch packages where a step says one at a time.
A passing build is NOT evidence an upgrade is safe: deprecated APIs still
compile, and changed defaults or rejected options only fail at runtime.

## 0. Before you start

- Branch off `main` as `chore/bump-dependencies` (branch rules in `.claude/CLAUDE.md`).
- **Never `git add -A`** — a working tree can hold untracked files that must not
  be committed. Stage by name: the `package.json` and `package-lock.json` files,
  `backend/patches/`, and any code you fixed.
- Versions are exact pins (`save-exact=true`), so `Wanted` equals `Current` in
  `npm outdated`; classify by `Latest`.
- Commit subjects: subject only, no body, no AI-attribution footer, at most 50
  characters. Count it — long package names don't fit `chore: bump <pkg> to <ver>`,
  so drop the version or shorten.

## 1. List outdated packages

```
npm outdated
npm --prefix backend outdated
npm --prefix frontend outdated
npm --prefix services/monitoring outdated
npm --prefix services/supermemory outdated
```

Classify every row:

- **SAFE** — `Wanted` and `Latest` match, or only the minor/patch number changes.
- **MAJOR** — the first number changes. Any `0.x` bump is MAJOR (pre-1.0 doesn't
  follow semver).

Exception: `@types/node` stays on the Node major in that location's Dockerfile
(`node:22-slim` today). A jump past it is MAJOR with nothing to read — it's types
only and has no changelog — so put it under "Needs manual action". The supermemory
server is pinned in `services/supermemory/Dockerfile`, not `package.json`, so it
never appears here; don't bump it.

Write out both lists before doing anything else.

## 2. Apply all SAFE updates

For each location, with only that location's SAFE names after `-f` (never run it
without `-f`; `-t minor` would also bump `0.x` packages from the MAJOR bucket):

```
npx npm-check-updates -u -t minor -f "<comma-separated SAFE names>"
npm install
```

For `services/monitoring` and `services/supermemory` use
`npx npm-check-updates --cwd <dir> ...` and `npm --prefix <dir> install` — root's
`postinstall` only installs backend and frontend.

**Then check nothing was left behind:** re-run `npx npm-check-updates -t minor`
(no `-u`) in every location. Anything it still lists that isn't in your MAJOR bucket
was missed — apply it.

Builds:

```
npm --prefix backend run build
npm --prefix frontend run build
npm --prefix services/monitoring run build
./services/monitoring/node_modules/.bin/tsc --noEmit -p services/supermemory
```

`services/supermemory` has no build script or TypeScript of its own; the last
command uses `services/monitoring`'s. Skip a location's `ncu`/`install` if nothing
is SAFE there, but still build it.

If a build fails, STOP: `git checkout -- <file>` that package.json/lockfile and
report which SAFE package broke it. Don't debug further.

If everything passes, commit now (`chore: bump SAFE dependencies`) so later
reverts can't undo it.

### Patched packages

`backend/patches/*.patch` (patch-package, applied by `backend`'s postinstall)
carries local edits to `@langchain/core`. Whenever a bump touches a patched
package:

- Never just rename the patch file to the new version. Check it applies cleanly
  to the new source and that its hunks still make sense there. One carried-over
  patch passed builds across three bumps while three of its four call sites
  referenced a variable that was never in scope.
- If it needs changes, apply the old patch to a pristine copy of the new version,
  fix it, and regenerate with `npx patch-package @langchain/core`.
- Run an abort-path check from `backend/` — a misscoped patch throws
  `ReferenceError` here and nothing else catches it:

```
node --input-type=module -e '
import { RunnableLambda } from "@langchain/core/runnables";
import { getEventListeners } from "node:events";
const r = RunnableLambda.from(async (x) => x);
const ac = new AbortController();
for (let i = 0; i < 20; i++) {
  for await (const _ of r.streamEvents("a", { version: "v2", signal: ac.signal }));
  for await (const _ of r.streamLog("a", { signal: ac.signal }));
}
console.log("abort listeners left:", getEventListeners(ac.signal, "abort").length);'
```

It must finish without an error and print `0`.

## 3. Handle MAJOR updates one package at a time

Repeat for each package in the MAJOR bucket:

1. Update just that package, in the `package.json` it lives in:
   `npx npm-check-updates -u -f <package-name>` then `npm install`.
2. Read what changed. All of it:
   - `node_modules/<package-name>/CHANGELOG.md` (also `CHANGES.md`, `HISTORY.md`):
     read the entry for EVERY version after the old one up to the new one, in full.
   - Open every http(s) link in those entries and in the README's upgrade/migration
     section with whatever web tool you have (a URL fetcher, or web search if that's
     all you have) — links containing `migrat`, `upgrad`, `breaking`, `release`,
     `guide` or `docs` first, but follow whatever the entry points to.
   - No changelog or no such link: `npm view <package-name> repository.url` and
     look up the releases page for the versions in between (the tag may be `v<ver>`,
     `<ver>`, or `<package-name>@<ver>`).
   - A page or search that returns little or no useful text is NO evidence.
3. List every API, option, default, import or behavior the entries say was removed,
   renamed, deprecated, newly rejected or changed. For each, search the whole repo,
   so config files (vite, eslint, tsconfig), scripts and Dockerfiles are covered:
   `grep -rn "<name>" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=build --exclude-dir=dist --exclude=package-lock.json`.
   Also grep every option our code passes into the package (options once accepted
   may now be rejected at runtime). For a changed default with no name to grep, read
   every call site. Compare the new version's `engines` and `peerDependencies`
   (`npm view <package-name>@<new> engines peerDependencies`) with the Node version
   in the workspace's Dockerfile and the other installed packages. Write each item
   and its result down.
4. Decide, on evidence only:
   - **No breaking change found** — only if you read the full entries, followed their
     links, and the grep found no hits. Move on.
   - **Breaking, code-level** (renamed import, changed signature, changed default,
     removed API) — fix every call site from the grep, then re-run it to confirm none
     remain.
   - **Breaking, needs something outside the code** (DB migration, new required env
     var, infra/CI change, data backfill) — don't attempt it. Revert that package's
     bump and lockfile and list it under "Needs manual action" with the exact
     package, versions and manual step.
   - **Unsure, or no evidence either way** (including an unreadable entry or guide) —
     revert the same way and list it under "Uncertain". Never pick "no breaking
     change" just because you found nothing.
5. Build that workspace again (`services/supermemory`: the `tsc --noEmit -p
services/supermemory` command from step 2; a patched package: also the
   abort-path check). If it fails and the error alone doesn't tell you the fix,
   revert and list it under "Uncertain". If it passes, commit that package alone.

Finish one package, build check included, before starting the next. Never move on
while the current one is broken.

## 4. Final report

Exactly these four sections, headings verbatim; every row from Step 1 appears in
exactly one section:

```
### Updated successfully
- <package>: <old> → <new> (SAFE / MAJOR, code changes: yes/no) — for MAJOR: files read and URLs fetched, with one quoted line

### Needs manual action (not applied)
- <package>: <old> → <new> — <what manual step is required>

### Uncertain — needs human review (not applied)
- <package>: <old> → <new> — <why you couldn't confirm safety>

### Build/test status
- backend build: pass/fail
- frontend build: pass/fail
- monitoring build: pass/fail
- supermemory typecheck: pass/fail
- abort-path check (if a patched package changed): pass/fail
- any other test suites run and their result
```

Don't push or open a PR unless asked.
