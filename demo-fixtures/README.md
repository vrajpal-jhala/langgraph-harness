# Demo Fixtures

Source material for producing product screenshots without touching real project data. `todo-app/` is a small standalone app pushed to a personal GitLab project as `main`; `feature-due-today/` is an overlay of just the changed file, applied on top of `main` to produce the branch behind the MR-review demo — it adds `GET /todos/due-today` with a deliberate off-by-one bug (`<= now` instead of a same-day check) and no test, giving the reviewer something real to flag.

## Usage

```bash
GITLAB_TOKEN=<personal access token, api scope> \
GITLAB_NAMESPACE=<your username or a group path you own> \
node demo-fixtures/seed-demo.mjs
```

This creates the project (if missing), pushes `main`, pushes the feature branch, opens the MR, and creates a separate issue ("Add a completed-count badge to `GET /todos`") for the work-item-resolve demo — skipping any step that's already done. Point a webhook at your tunneled dev backend, then assign the issue to your bot user to trigger a real run.

`--reset` deletes the project first and reseeds from scratch. Never run it against a project that already has real review comments or replies you want to keep.

Once the initial review demo is captured, run the same command with `--fix-bug` to push a follow-up commit onto the feature branch that fixes the off-by-one and adds the missing test — this lands as a new commit on the open MR, triggering a re-review, for the "bot approves after the fix" screenshot.
