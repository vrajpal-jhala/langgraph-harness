---
name: update-changelog
description: >
  Draft a CHANGELOG.md entry (and matching semver bump) for the work just
  finished on this branch, and update the relevant README if the change is
  worth surfacing there. Use when the user says "update changelog", "changelog
  this", "prepare release notes", "bump version", or "/update-changelog" — typically
  once a feature or fix is done and about to merge, not mid-development.
---

Root `CHANGELOG.md` and root `package.json`'s `version` are the source of
truth. Every entry corresponds 1:1 with a version bump — never add one without
the other.

## 1. Scope the change

Diff against the last version bump, not just the latest commit:

```
git log --oneline <last-tag-or-commit-before-bump>..HEAD
git diff <last-tag-or-commit-before-bump>..HEAD
```

If unsure where the last bump landed, `grep -n "^## \[" CHANGELOG.md | head -1`
gives the current top version; find the commit that added it.

While you have that commit list, audit subject-line length and body presence
against this repo's standard (see `CLAUDE.md`): 50 chars target, 72 hard
limit, subject-only with no body — it applies to every commit, no
exceptions. Fixing a commit already in history means a rebase, which is
destructive, so get the user's explicit go-ahead before doing that; but
don't downplay a violation as optional just because fixing it takes an extra
step. Any commit this skill creates itself (step 5) must simply never
violate either rule in the first place.

Also check the current branch name (`git branch --show-current`) against
this repo's standard (see `CLAUDE.md`): `<type>/<short-kebab-description>`,
`type` from the same Conventional Commits vocabulary as commit subjects
(`feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `perf`, `test`).
Renaming a branch that's already pushed/tracked upstream affects a shared
ref, so flag a violation to the user rather than renaming it yourself.

Also read `CLAUDE.md`'s full "Code style" section (not just the commit/branch
rules above) and check it against the diff being documented — most commonly
its comment rules (one line, glued to the line it explains, WHY not WHAT).
Do this before writing the entry, not after the user has to point out a
violation. Fix violations in the diff itself if the underlying change is
still uncommitted; if it's already committed, flag it the same way as a
subject-line violation above rather than silently ignoring it.

Also check whether this diff changes anything `docs/architecture.md` describes — a component
added or removed, a harness's tool surface or data flow changed, or something moving between
Built/Partial/Pipeline status. If so, invoke the `sync-architecture` skill, passing it this
same diff range so it doesn't recompute it — that skill stays scoped to the architecture doc,
this one stays scoped to CHANGELOG.md/README/version.

Then run `git status --short`. A changelog entry documents committed history,
not the working tree — if uncommitted changes to source files are what the
entry is actually about, the version bump would land describing work that
isn't in the repo yet. Stop and ask the user whether to commit the underlying
change first, or whether this entry should wait. Don't bump the version over
unfinished/uncommitted work just because it exists in the working tree.

If offering to commit it, suggest both a message (50/72-char rule above) and
a branch name (`<type>/<short-kebab-description>`, same convention as the
branch-name check above) — this repo's fixes land on their own branch, not
committed straight onto `dev`/`main`. A message alone leaves the branch
question unanswered.

Only user-facing changes belong in the log: something a person using langgraph-harness
(reviewer, admin, developer running the app) would notice or benefit from
knowing about. Skip pure internal refactors, test-only changes, dependency
bumps with no behavior change, formatting. A backend bug fix still counts as
user-facing if it changes what the user observes (a crash stops happening, a
run completes instead of hanging) — judge by observable effect, not by which
files changed.

## 2. Write entries in the existing style

Read the top 2-3 entries in `CHANGELOG.md` before writing — the format is
consistent across 30+ releases:

- One bullet per distinct change.
- `**Bold one-line hook naming the symptom or capability**` — em dash — plain-
  prose explanation of the fix/behavior in user terms.
- No internal file paths, function names, or variable names in the prose.
  Describe outcomes ("the run now retries once before giving up"), not
  implementation ("wrapped the call in `retryWithBackoff`").
- Only three section headers ever appear, in this order when present:
  `### Features`, then `### Fixes`, then `### Breaking Changes`. Don't invent
  new section names (no "Chores", "Internal", etc.) — if it doesn't fit one
  of these three, it probably doesn't belong in the log at all.
- `### Breaking Changes` holds only entries where an existing user/config must
  change something to keep working — the header itself says "breaking", so
  don't also prefix the bullet with "Breaking:". Everything else that ships
  alongside it (the new capability the breaking change enables, unrelated
  fixes) still goes in `### Features`/`### Fixes` as normal.
- Entries separate with a `---` horizontal rule between version blocks.

## 3. Pick the version bump

This repo has only ever done patch and minor bumps (still on major `1`) — but
apply real semver:

- **Patch** (`x.y.Z+1`): only `### Fixes` in this release.
- **Minor** (`x.Y+1.0`): any `### Features` present, even alongside fixes.
- **Major** (`X+1.0.0`): a breaking change — something existing users/configs
  must change to keep working (removed capability, incompatible data/config
  format, changed default that alters existing behavior) — goes in its own
  `### Breaking Changes` section at the end of the entry (see step 2), which
  is what actually triggers the major bump. Flag this explicitly to the user before bumping
  major; don't do it silently, since a major bump is an unusual call in this
  repo's history.

Insert the new block at the top of `CHANGELOG.md`, dated with today's actual
date (never fabricate — get it from the environment), then bump
`package.json`'s `version` field to match. Run `npm i` right after so
`package-lock.json`'s `version` field stays in sync — don't edit the lockfile
by hand or leave it stale.

## 4. Decide if a README needs updating

There are three: root `README.md`, `backend/README.md`, `frontend/README.md`.
Check all three, independently — a backend-only change might warrant updating
`backend/README.md` but not the root one, and vice versa.

A change is "worthy" of a README update if a developer or user would need to
discover it to actually use that part of the app: a new script, a new
required env var, a changed setup/prerequisite step, a new top-level
capability the README already describes at a high level. It's not worthy if
it's purely internal (a bug fix invisible to setup/usage, a refactor, a
robustness improvement with no new surface).

For each of the three, if worthy: find the relevant existing section and
update it in place, matching its existing tone and structure — don't add new
sections speculatively. If not worthy: say so explicitly ("no README update
needed — this is an internal fix with no new surface") rather than skipping
the check silently.

## 5. Commit

Re-check `git status --short` right before committing — if the change being
documented still isn't committed (someone may have started editing again
mid-skill-run), stop instead of bumping the version ahead of it.

Stage the changed `CHANGELOG.md`, `package.json`, `package-lock.json` (from
the `npm i` in step 3), and any README files touched, and commit with the
repo's standard message:

```
chore: bump version and update changelog
```

Count this subject line against the same 50/72-char limit before committing
(step 1).

Don't fold in unrelated uncommitted changes — stage only the files this skill
touched.
