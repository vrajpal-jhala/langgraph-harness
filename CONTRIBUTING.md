# Contributing

## Setup

```bash
npm install
cp backend/.env.example backend/.env
# fill in required values, see README Quick Start
npm run dev
```

## Before opening a PR

```bash
npm run format:check
npm --prefix backend run typecheck && npm --prefix backend run lint
npm --prefix frontend run typecheck && npm --prefix frontend run lint
npm run build
```

CI runs the same checks. There is no test suite yet ([#15](https://github.com/vrajpal-jhala/langgraph-harness/issues/15)) — until then, describe how you verified your change manually in the PR.

## PRs

- Keep PRs scoped to one change; unrelated cleanup goes in its own PR.
- Update `CHANGELOG.md` under `[Unreleased]` for any user-facing change.
- Disclose AI assistance (the PR template has a checkbox for this) — we allow it, we just want to know the context.

## Branch names

Format: `<type>/<issue-number>-<short-kebab-description>`, e.g. `fix/42-silent-tool-rejections`, `feat/17-repo-memories`. `type` is one of the [Conventional Commits](https://www.conventionalcommits.org) types below. Skip the issue number only if there isn't one.

## Commit messages

- Prefix the subject with a [Conventional Commits](https://www.conventionalcommits.org) type: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `perf`, `test`.
- Subject line under 72 characters; add a body when the change needs more explanation than the subject can carry.
- If the commit was AI-assisted, keep the tool's attribution footer (e.g. `Claude-Session:`) rather than stripping it — it helps us see where AI is being used.
