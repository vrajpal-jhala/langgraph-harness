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
