# langgraph-harness — Git & Repository Management

> **Domain owned by this document:** repository _storage and lifecycle_ — canonical bare repos,
> worktrees, the `RepositoryManager`, the internal `GitService`, fetch, cleanup, and maintenance.
> Nothing else.

## Goals

- Minimize GitLab API usage; provide fast local access to repository contents.
- Support concurrent analysis of multiple MRs without duplicating repository data.
- Be resilient to crashes and missed webhooks.
- Scale to many repositories with minimal maintenance.

The GitLab API is a collaboration layer (metadata, comments, approvals), not the primary source
of repository information.

---

## Repository Layout

Maintain exactly one canonical repository per remote. Each active MR receives its own worktree.

Root is the existing `DATA_PATH` env var (`backend/.env.example`, default `./.harness`) — already the
persistent-data root for `postgres/` and `redis/` in `docker-compose.yml` / `docker-compose.dev.yml`.
`app/` is added as a third sibling folder, one per service (matching `postgres/`/`redis/`), holding
everything this backend owns; `repositories/` and `worktrees/` live inside it. `deploy.sh` and
`dev.mjs` only need one matching `mkdir -p` for `app/` itself — the backend creates its own
`repositories/`/`worktrees/` subfolders on demand, so infra never has to track the backend's internal
layout as it grows.

```
${DATA_PATH}/
    postgres/
    redis/
    app/
        repositories/           ← canonical bare repositories (Git objects)
            organization/repository.git/
        worktrees/              ← one worktree per active MR
            organization/repository/
                mr-123/  mr-456/  mr-789/
```

### Why bare repositories?

Instead of a checked-out copy of `main`, the canonical repo is **bare**:

- no unnecessary working directory; smaller footprint;
- accidental file modification is impossible; every checkout is an explicit worktree;
- mirrors how CI systems and Git hosting platforms manage repositories.

---

## RepositoryManager

Only one component knows how repositories are stored. No other component invokes git directly.

Lives at `backend/src/components/repositories/` — a new peer component (`manager.ts` for
`RepositoryManager`, `service.ts` for `GitService`, `dal.ts` for worktree metadata — persisted in
Postgres, not sidecar files, since reconciliation needs to query it, not walk the filesystem),
not nested inside `webhooks/` or `workflow/`.
Both of those are consumers (`webhooks/` triggers cleanup on merge/close, `workflow/`'s tools call
`diff()`/`changedFiles()`) — nesting the repo-storage subsystem inside either would have one
consumer importing sideways from another, inverting the dependency direction. Same reasoning
`db.ts`/`redis.ts` already follow by sitting outside any single domain in `utils/`; this is just
big enough to warrant its own component folder instead of a single utils file.

```
RepositoryManager
├── ensureRepository()
├── fetchRepository()
├── acquireWorktree()
├── cleanupWorktree()
├── cleanupRepository()
├── maintenance()
├── reconcile()
└── healthCheck()
```

`releaseWorktree()` is not a manager-level method — release happens on the lease object itself (see
below), the same shape as `pg.Pool.connect()` returning a client with `client.release()`.
`RepositoryManager` still owns the actual state mutation internally; the lease's `.release()` just
delegates back into it.

### Worktree acquisition (leases)

Consumers never manipulate worktrees directly — they acquire a lease and always release it:

```ts
const worktree = await repositoriesManager.acquireWorktree({
  repo: 'organization/repository',
  entityType: 'mr', // or 'issue'
  iid: '123',
  ref: 'feature/auth',
});
try {
  // analysis
} finally {
  await worktree.release();
}
```

`iid` is named generically, not `mrIid` — `entityType` already discriminates which kind of entity
it is, so embedding that again in the field name would be redundant. Matches GitLab's own webhook
shape (`object_kind` + a generically-named `object_attributes.iid`), which `webhooks/index.ts`
already destructures this way.

Internally: create the worktree if necessary, mark it leased, prevent deletion while active, and
auto-release. A single `leased` boolean, not a reference count — at most one review runs per MR at
a time (`enqueueReview`'s stable per-MR `jobId` in `components/runs/queue.ts` means BullMQ never
runs two jobs for the same MR concurrently), so there's never more than one holder to count.
Revisit if a second concurrent consumer of the same worktree ever exists.

### Run steps (within a run, outside the graph)

Acquisition happens in `runsService.execute()` — inside a run but **outside** the LangGraph review
graph. It has to: the lease must be released on success/error/abort (a `finally`, which a terminal
graph node can't guarantee), and it must re-acquire on checkpoint-resume (a node _past_ the resume
checkpoint is skipped, so acquisition can't live in one). Acquisition is fully local and fatal — if
it fails the run fails; there is no GitLab diff fallback.

This "work within a run but outside the graph" is a **run step**, surfaced in the run timeline with
`run_step_start` / `run_step_end` events (see the `RunStep` union in `types.ts`) rather than reusing
node events (it isn't a graph node). `prepare_worktree` (clone/fetch/checkout) is the only run step
today; its `run_step_end` carries `{ repo, ref, cloned, revived, error }`. Add a `RunStep` value for
any future out-of-graph step instead of a new event type.

### Worktree naming

Folders are named `{entityType}-{iid}` — stable identifiers, **not** branch names, since branches
rename, multiple MRs may share similar branch names, and identity must stay stable for the life of
the worktree:

```
mr-123   mr-456   issue-991
```

Only `mr` exists today — no issue-webhook handling exists anywhere in the codebase yet. `issue` is
kept as a second type to define the norm early, since GitLab issues are a real, structurally
similar future entity. An ad-hoc/manual-review type was considered and dropped: no manual-trigger
endpoint exists, and there's nothing concrete driving it — add it back if a real need shows up.

### Worktree metadata

`repo`/`entityType`/`iid` are the entity's fixed identity, set once at creation. `ref` is the
current checkout target and is the volatile part — it's what `checkout()` updates on every
re-review push. Named `ref`, not `branch`: an MR's branch name doesn't change after creation, but
its commit does with every push, and a future entity type (e.g. an issue) may have no branch of
its own at all — the field has to describe "what's currently checked out," not assume an
MR-specific concept.

```json
{
  "repo": "organization/repository",
  "entityType": "mr",
  "iid": "123",
  "ref": "feature/auth",
  "createdAt": "...",
  "accessedAt": "...",
  "leased": true,
  "pendingDelete": false
}
```

Persisted in Postgres (`worktree_leases` table, `components/repositories/dal.ts`), not sidecar
files — reconciliation and periodic cleanup both need to query it (e.g. "every row with
`leased = false` and `accessed_at` past retention"), which is a query against a table and a
filesystem walk + JSON parse per worktree otherwise:

```ts
db.schema
  .createTable('worktree_leases')
  .addColumn('id', 'text', (col) =>
    col.primaryKey().defaultTo(sql`gen_random_uuid()`),
  )
  .addColumn('repo', 'text', (col) => col.notNull())
  .addColumn('entity_type', 'text', (col) => col.notNull()) // 'mr' | 'issue' — app-level union, same pattern as runs.status
  .addColumn('iid', 'text', (col) => col.notNull())
  .addColumn('ref', 'text', (col) => col.notNull())
  .addColumn('leased', 'boolean', (col) => col.notNull().defaultTo(false))
  .addColumn('pending_delete', 'boolean', (col) =>
    col.notNull().defaultTo(false),
  )
  .addColumn('created_at', 'timestamptz', (col) =>
    col.notNull().defaultTo(sql`NOW()`),
  )
  .addColumn('accessed_at', 'timestamptz', (col) =>
    col.notNull().defaultTo(sql`NOW()`),
  )
  .addUniqueConstraint('worktree_leases_repo_entity_iid', [
    'repo',
    'entity_type',
    'iid',
  ]);
```

`(repo, entity_type, iid)` is the natural key `acquireWorktree()` looks up by; the UUID `id` is
just for consistency with every other table (`threads`, `runs`), not because anything references
a worktree row by FK. Hard delete, no `deleted_at` — matches the existing convention (`runs`/
`threads` already use cascading hard deletes, no soft-delete anywhere in the schema) and there's
no historical/observability value in a lease row once its worktree is gone: unlike `runs`/
`threads`, whose content _is_ the product worth looking back at, a worktree lease is pure
bookkeeping ("was this in use") with nothing left to reference once it's reclaimed.

### Concurrency & locking

Three layers guard concurrent access, each covering a different scope:

- **BullMQ queue (review vs review).** `enqueueReview`'s stable per-MR `jobId` means at most one
  review runs per MR at a time — this is what backs the single `leased` boolean (see above). No two
  `acquireWorktree` calls for the same MR ever overlap.
- **`withLock(key)`, key = `repo:entityType:iid` (per worktree).** Serializes everything that mutates
  one worktree's state — `acquireWorktree`, the lease's `release()`, `cleanupWorktree`, and
  `maintenance()`'s per-worktree removal — so a stale-cleanup can't free a worktree out from under a
  concurrent re-acquire.
- **`withLock(repo)` (per bare repo).** Serializes operations on the shared bare repo against each
  other: `ensureRepository` (clone-if-missing), `cleanupRepository`, and `maintenance()`'s repo `gc`.
  This is what stops `git maintenance run` from firing on a repo that `cleanupRepository` is deleting.

Two gaps are deliberate, both benign under "one workflow at a time" — revisit when concurrency
across workflows is added:

- `fetch` runs _outside_ `withLock(repo)` (the repo lock wraps only `ensureRepository`). Concurrent
  `fetch`/`maintenance` on the same repo is left to git's own lockfiles, which handle it safely.
- `maintenance()`'s repo `gc` locks per repo, not against an in-flight `worktreeAdd` (which locks per
  worktree). A prune racing an add is possible in theory; it can't happen today.

---

## GitService

Git operations are a thin wrapper around the git CLI via `execa`:

```
clone()  fetch()  checkout()  mergeBase()  revParse()  diff()  changedFiles()  grep()  fileDiff()
```

- `diff()`, `changedFiles()`, `grep()` — **LLM-facing.** The review workflow's actual input: the
  changed-file list, the patch itself (diffed against the merge base, not the moving target branch),
  and content search across the worktree (`git grep`) to trace callers/callees before commenting.
- `clone()`, `fetch()`, `checkout()`, `mergeBase()`, `revParse()` — **internal only.** Repo lifecycle
  and worktree setup/update, plus verifying a resolved ref against a known sha (see "Retrying a run
  after the source branch is gone" below); never called directly by the LLM.
- `fileDiff()` — **internal only.** A single file's `base...head` patch, used to validate a draft
  comment's position locally before it reaches GitLab (outside this document's domain — see
  `workflow/middlewares/draft-integrity.ts`).

`show()`, `log()`, `blame()`, `status()` are deliberately not built for v1: worktrees are never
manually touched by design, so there's nothing for `status()` to catch yet; per-commit review
(`show()`/`log()`) is actively worse than whole-MR diffing for a large MR, since a bug introduced
in one commit and fixed in a later one would show as a false positive instead of the net-zero
change it actually is — the right lever for large MRs is chunking `diff()`/`changedFiles()` by
file, not walking commit history. Revisit only if a concrete need shows up.

`execa` over `simple-git` because langgraph-harness is fundamentally git-powered and needs `merge-base` (backs
`mergeBase()`) and `worktree` (the whole `RepositoryManager` design) plus streaming,
cancellation/timeout handling, and easy logging — without wrapper limitations, while still exposing
a clean internal API. `GitService` is internal — LLM-facing read tools are built on top of it
elsewhere.

### Cancellation

Run-scoped operations — `clone`/`fetch`/`checkout`/`worktreeAdd` during acquisition, plus the
LLM-facing `mergeBase`/`diff`/`changedFiles` — take an optional `AbortSignal`, threaded from the
owning run (`runsService`'s per-run `AbortController`) through `acquireWorktree` → `GitService` →
execa's `cancelSignal`. Aborting a run (user cancel or shutdown's `abortAll()`) therefore kills its
in-flight `git` subprocess instead of letting a slow clone/fetch run to completion. Enforcement can
only happen at the execa layer (nothing else can kill the child), but the signal is _plumbed_ down
from the run — the same shape as the argv/path guards: fed from the caller, enforced at the sink.
Maintenance, reconciliation, and release ops are not run-scoped and deliberately omit the signal.

### Fetch strategy

Perform exactly one `git fetch --prune` per repository before analysis; individual tools never
fetch. All tools then read from the same up-to-date repository. `--prune` also removes local refs
for branches deleted upstream (see Repository retention & maintenance) — one flag, no separate
periodic job needed for it.

_(Concurrent analyses on the same repo could each trigger their own fetch — not handled today,
only one workflow exists. Revisit if/when concurrency across workflows is added.)_

### Retrying a run after the source branch is gone

Worktrees are acquired by branch **name** (`query.sourceBranch`), not by commit SHA. Once an MR
merges with GitLab's "delete source branch" option, the branch no longer exists on the remote,
and the next `fetch --prune` for that repo removes the local remote-tracking ref too. Retrying an
**older run** for that MR (created back when the branch still existed, e.g. a run that failed for
an unrelated reason before the merge) would otherwise fail outright at the worktree-acquire step —
`git checkout`/`worktree add` has nothing to resolve `sourceBranch` to.

Before local git was wired in, retry went entirely through GitLab's API, scoped by MR IID. GitLab
records `diff_refs` (base/head/start SHAs) on the MR object at merge time, so those endpoints keep
working indefinitely — they were never asking "does this branch still exist," only "give me MR
!123's diff." That resilience was implicit and free; switching to local git dropped it, so it's
rebuilt here instead.

**Fix:** `query.sourceSha` (from the webhook's `object_attributes.last_commit.id`, threaded through
`validation.ts`/`runs/service.ts` the same way `sourceBranch` was) is passed to
`acquireWorktree`. `acquireWorktree` (`manager.ts`) tries the normal branch-name
checkout/`worktreeAdd` first — unchanged fast path — and only on failure falls back to
`gitService.fetchAndTagSha` (`service.ts`): fetch the SHA directly (`git fetch origin <sha>`),
then `git update-ref refs/heads/<branch> <sha>` to revive the branch ref locally, then retry the
checkout. Fallback-only, not fetch-by-SHA-always: keeps the common-path fetch unchanged and
confines the unverified "does GitLab allow fetching arbitrary SHAs" risk
(`uploadpack.allowReachableSHA1InWant`, on by default for GitLab self-managed/SaaS) to the retry
path where it actually matters. The fallback lives in `acquireWorktree`, not `runs/service.ts` —
it's the single choke point for both attempts, so callers don't need to know refs can be resolved
two ways.

`sourceSha` is always persisted (not resolved lazily only after a checkout failure) — one extra
string is cheap, and lazy resolution would need the original webhook payload kept around just for
this. `targetBranch` stays name-only: it's normally a long-lived branch (`main`, `dev`), and
deletion there isn't a realistic case worth designing around.

**A successful checkout isn't proof it landed on the right commit.** If the branch is deleted and
later **recreated** under the same name pointing at different content, the fast-path
checkout/`worktreeAdd` resolves it silently — no error, no fallback triggered, worktree checked out
against the wrong commit. `checkoutWithShaFallback` (`manager.ts`) guards against this: whenever
`sha` is known, it `revParse`s the resolved ref after a successful op and compares it against the
sha; a mismatch is treated exactly like a thrown failure, driving the same
`fetchAndTagSha`-and-retry recovery. Covered by a regression case in `scripts/verify_repositories.ts`
(`[7/9]`) that deletes and recreates a branch mid-run and asserts the wrong content never surfaces.

**Logging stays quiet for the expected case, loud for everything else.** The first attempt's
failure is expected whenever `sha` is available — that's exactly the scenario this fallback exists
for — so `git()` (`service.ts`) takes a `quiet` flag and `checkout()`/`worktreeAdd()` pass it
whenever a sha is available, suppressing the error log for that one attempt. A failure with no
`sha` to fall back to, or the retry after revival/verification still failing, is a genuine problem
and logs normally. The lease returned by `acquireWorktree` carries `revived: boolean` — whether the
fallback fired at all this acquisition — surfaced on the run's `run_step_end` event for
observability, and (outside this document's domain — see `workflow/tools.ts` and
`workflow/middlewares/dynamic-diff-tools.ts`) used to choose between local git diff tools and
GitLab's own when the source branch turned out to be gone.

An adjacent bug this depends on: plain `git fetch --prune` was a no-op against `refs/heads/*`
because bare clones never get a fetch refspec configured by default — branches silently never
updated past the initial clone, and prune never pruned. Fixed by passing the mirror refspec
explicitly on every fetch (`fetch origin +refs/heads/*:refs/heads/* --prune`).

---

## Cleanup & resilience

### 1. Merge Request webhooks (primary)

`webhooks/index.ts` handles `merge`/`close` alongside `open`/`reopen`/`update`: when an MR is merged
or closed it calls `cleanupWorktree` — if the worktree is not `leased`, remove it now; if still
leased, set `pending_delete = true` and delete after the final lease releases.

No separate branch-deletion webhook needed. Worktrees are keyed by MR `iid`, not by branch name, so
what actually signals "this worktree is done" is the MR's own lifecycle, independent of whether
GitLab's "delete source branch on merge" happens to be enabled for that repo. A missed merge/close
webhook is already covered by tier 2's retention fallback below.

### 2. Periodic cleanup (fallback)

Runs periodically — an in-process self-rescheduling timer (not cron: maintenance acts on this
process's own filesystem and lock state). Deletes worktrees that are not `leased` and are either
past the retention period (**7 days** — covers a long weekend with margin) or marked
`pending_delete` — protecting against missed webhooks and outages. No GitLab existence check (no "MR no longer
exists" call) — a false-positive cleanup just means re-cloning from scratch next time, which is
cheap, so there's no need to spend GitLab API calls confirming an MR still exists.

### 3. Startup reconciliation

On startup, for each canonical repo: compare `git worktree list` (more authoritative than a raw
directory listing — it's git's own bookkeeping) against `worktree_leases` rows.

- Row exists, directory missing — drop the row. Can't recover it, and per the periodic-cleanup
  reasoning above, cheap to recreate from scratch if it's needed again.
- Directory exists, no row — orphan. Remove the directory, then `git worktree prune` for that repo
  to clear git's own stale administrative entry.
- Both exist — keep the row, but force `leased = false` regardless of its stored value. `leased`
  only means anything within a single running process; a crash means the in-flight lease's
  `.release()` call is gone forever, so a persisted `leased = true` could never be cleared after
  restart — permanently locking that worktree from cleanup. No restart can have any real active
  leases yet.

---

## Repository retention & maintenance

Canonical repositories generally stay cached. Eviction policy (LRU, max repository count, max disk
usage) is deferred — canonical repos are already cheap relative to worktrees (one bare repo per
remote regardless of MR churn; growth here is a long tail of distinct repos accumulating, not
per-MR volume, which the 7-day worktree retention already handles). Revisit if disk pressure
actually shows up. Before deletion and periodically, let git optimize storage:

```
git worktree prune   git maintenance run
```

`git maintenance run` replaces a bare `git gc` call — it's git's own newer scheduler-friendly
maintenance command and already runs gc-equivalent work (repack, prune loose objects) alongside
lighter incremental tasks, so running both would do the same job twice. Its lighter tasks (e.g.
`--task=incremental-repack`) also make "avoid running during a review storm" less of a manual
scheduling concern than a full `gc` would be.

No separate `git remote prune origin` step — folded into the existing fetch instead (see Fetch
strategy above: `git fetch --prune`), since a plain fetch never removes local refs for branches
deleted upstream (common here, given GitLab's "delete source branch on merge") and a standalone
prune command would need its own periodic job for something one flag on an operation already run
once per repo can do instead.

---

## Overall architecture

```
                    RepositoryManager
                           │
        ┌──────────────────┴──────────────────┐
   Repository Cache                    Worktree lifecycle
   (bare repositories)                 (git worktrees: acquire/release/cleanup/metadata)
        │  fetchRepository() · maintenance() · healthCheck()
        │
   GitService (execa)
        │
   consumed by → LLM-facing read tools (Git tool, local fs read tools — outside this
                 document's domain, see workflow/tools.ts) and repowise (code intelligence,
                 against worktrees)
```

## Design principles

- One canonical (bare) repository per remote; one worktree per active MR.
- A single `RepositoryManager` owns repository lifecycle; no other component runs git directly.
- Git CLI wrapped by an internal `GitService` (`execa`).
- Worktrees acquired through single-holder leases (a `leased` boolean, not a count) with automatic release.
- Merge/close webhooks trigger cleanup; periodic cleanup and startup reconciliation provide resilience.
- Repository access for analysis is local (git + filesystem) by default. The deliberate exception
  is a merged-branch retry, where local diffing structurally can't recover the history (squash or
  fast-forward merges leave nothing to diff against) — see "Retrying a run after the source branch
  is gone".
