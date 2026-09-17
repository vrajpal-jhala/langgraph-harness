# Per-Repo Configuration

Drop a `.harness.yml` at the root of a project's default branch to customize how langgraph-harness treats that project. It's entirely optional — a missing or invalid file just means "run with defaults."

<<< @/harness-config/v1.example.yml

## What each section does

- **`mr_review_instructions` / `work_item_resolve_instructions`** — repo-specific guidance (conventions, review checklists, language-specific notes) fed to the agent as scoped context. `match` globs let you attach a doc only when the changed files warrant it — a TypeScript style guide doesn't need to load for a Python-only MR.
- **`exclude_branches`** — skip review entirely for branches that don't need it (release branches, WIP branches, a `staging` promotion merge).
- **`mr_review_requires_harness_reviewer`** — opt into requiring the bot be explicitly added as a reviewer before it comments, instead of reviewing every MR by default.

This is application-level config, separate from the environment variables in [`backend/README.md`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/backend/README.md) — those configure the harness instance itself; `.harness.yml` configures how it treats one specific project.
