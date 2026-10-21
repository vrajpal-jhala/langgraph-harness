# AI Notice

## What was asked

Add GitHub support, picking the item from the README roadmap ("GitHub support: assign an issue to the bot, get a draft PR"), keeping the workflow common with GitLab where possible.

## Direction given

The user chose the scope and setup decisions interactively:

- Mirror the GitLab demo setup on GitHub: a `langgraph-harness-demo` org with a public `todo-app` repo, and a separate `langgraph-harness-bot` account as an org member with maintain access.
- Public repo, because draft PRs on private repos need a paid plan.
- Use GitHub's official MCP server over HTTP (hosted by default, overridable via `GITHUB_MCP_URL`), since it ships only as a Go binary.
- Split the work: phase 1 is issue assignment -> sandboxed run -> draft PR + status comment, plus worktree cleanup on close. PR-comment follow-ups are phase 2.
- For PR feedback, use the vendor MCP tools as they are and watch real runs before building any combined tool.
- Keep env vars organized like the GitLab ones, rename internal webhook identifiers for symmetry without breaking env vars or routes, and use only the provider's own term ("merge request" or "pull request") in anything posted or prompted.

## How the work evolved

The agent proposed the plan and design; the user reviewed each decision, corrected scope (phase split, no combined feedback tool yet), and asked for naming and wording changes mid-implementation. The code itself was written by the agent and has been typechecked and linted, but not yet run end to end against GitHub.

## GitHub sign-in and provider choice

### What was asked

Pick up the open "Add GitHub as a sign-in provider" issue on a branch stacked on the GitHub issue-source work, then make the deployment require GitLab or GitHub rather than both, and update the docs to match.

### Direction given

- Branch from the issue-source branch, since both touch the same config, env and auth files.
- Rename for GitLab/GitHub parity: the session's `username` became `gitlabUsername`, and `WEBHOOK_TOKENS` became `GITLAB_WEBHOOK_TOKENS`. This reverses the earlier "without breaking env vars" choice: existing deployments must rename that variable.
- Let users connect a second provider from Settings even when its email differs from their sign-in email, once the agent explained the tradeoff.
- Leave GitHub Enterprise sign-in out for now; the sign-in library's GitHub provider only supports github.com.
- Make each provider all-or-nothing (bot token, bot username, webhook secret, OAuth client ID and secret, admin usernames), require at least one, and fail at boot naming the missing variables when one is partly set. Decide which providers are on once, in config.
- Document the GitLab, GitHub and both-provider paths, which features are GitLab-only for now, local webhook forwarding with `gh webhook forward`, and that the demo fixtures only seed GitLab.

### How the work evolved

The scope grew from an optional sign-in button into making GitLab itself optional: the original sign-in design assumed GitLab was always configured, and the user then asked for GitHub-only deployments to work. Along the way the agent proposed the identity model (per-provider usernames and admin lists, a shared email-domain restriction), and the user corrected naming and asked for the cross-email linking. The agent wrote the code and docs, which typecheck and lint, and the env validation was exercised directly; neither sign-in nor a GitHub-only deployment has been run end to end.
