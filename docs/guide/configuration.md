# Per-Repo Configuration

Drop a `.harness.yml` at the root of a project's default branch to customize how langgraph-harness treats that project. It's entirely optional — a missing file just means "run with defaults." An invalid one also runs with defaults, and the run's page, linked from its status comment, shows what's wrong, such as an unknown key.

<<< @/harness-config/v2.example.yml

## What each section does

- **`review.instructions` / `resolve.instructions`** — repo-specific guidance (conventions, review checklists, language-specific notes) fed to the agent as scoped context. Under `review`, `match` globs let you attach a doc only when the changed files warrant it — a TypeScript style guide doesn't need to load for a Python-only change.
- **`review.exclude_branches`** — skip review entirely for branches that don't need it (release branches, WIP branches, a `staging` promotion merge).
- **`review.requires_reviewer`** — opt into requiring the bot be explicitly added as a reviewer before it reviews, instead of reviewing every merge or pull request by default.

Both sections apply the same way on GitLab and GitHub. `resolve` covers issue runs and tasks.

## Upgrading from version 1

Version 2 renamed every key, and a version 1 file (or one without `version`) is no longer read: its runs go ahead without instructions, and the run's page shows the error with a link here. Rename the keys:

| Version 1                             | Version 2                  |
| ------------------------------------- | -------------------------- |
| `mr_review_instructions`              | `review.instructions`      |
| `exclude_branches`                    | `review.exclude_branches`  |
| `mr_review_requires_harness_reviewer` | `review.requires_reviewer` |
| `work_item_resolve_instructions`      | `resolve.instructions`     |

`match` is only accepted under `review.instructions` now; it was ignored on resolve instructions before.

This is application-level config, separate from the environment variables in [`backend/README.md`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/backend/README.md) — those configure the harness instance itself; `.harness.yml` configures how it treats one specific project.
