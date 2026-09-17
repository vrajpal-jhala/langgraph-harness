# Features

The landing page covers the four workflows. This page goes into what actually makes a run trustworthy — the tools it can reach, the guardrails that catch it misbehaving, and the checks a comment goes through before it's ever posted.

## Tool access

- **GitLab** — MR metadata, diffs, discussions, draft notes, approvals, issues and work items, all via a GitLab MCP server. Write actions (posting comments, resolving threads) are kept in a separate allowlist from reads, so the agent can be given broad read access without broad write access.
- **Local git** — changed-files, diff, and file-diff tools that read the actual worktree, not just GitLab's API view of it. On a revived retry (branch already deleted after a squash/fast-forward merge), local diffing can't recover the merge — the agent swaps to GitLab's `diff_refs`-based tools instead, which survive branch deletion regardless of merge strategy.
- **Filesystem** — grep, read one or many files, list a directory, scoped to the run's own sandboxed checkout.
- **Web fetch** — a real headless browser (Lightpanda, via CDP), not a raw HTTP fetch, so JS-rendered pages resolve — with Readability-based content extraction and DNS/IP-range blocking against internal/private addresses before a fetch is allowed through.
- **Self-introspection** ("server tools" in Chat) — query past reviews, past chat threads, a specific run's full event transcript, and project/personal memories. This is what lets Chat answer "why did the review on !142 time out?" from its own history instead of guessing.
- **Sub-agents** — a spawned sub-agent independently verifies a specific concern (e.g. "does this file actually handle the edge case it claims to"), reported back to the parent run rather than trusted on the parent's own say-so.

## Guardrails

Every guardrail is a _backstop_, not the primary correctness mechanism — the system prompt already asks for the right behavior. These catch it when a run doesn't comply anyway, nudge a correction, and escalate to a hard abort only if the pattern keeps repeating.

| Guardrail                   | Catches                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate Call Guard**    | A tool call repeated past a sane limit — including a third-party MCP tool that reports failure via its response content instead of throwing, which would otherwise loop silently.           |
| **Trailing Question Guard** | A run that closes on a question mark ("would you like me to...?") instead of just finishing — the system prompt's "never ask mid-task" rule doesn't obviously cover how a run should _end_. |
| **No Tool Call Guard**      | A run that concludes by only restating an earlier turn's summary, without re-verifying current state via any tool call.                                                                     |
| **Discussion Check Guard**  | A run that never checked for review feedback before concluding — matters most on a resumed run, where a new comment can land after the run is already underway.                             |
| **Human Approval**          | Pauses mid-run on a tool call that needs explicit sign-off before it proceeds (Chat).                                                                                                       |

## Quality control before anything posts

- **Comment Critic** — screens every batch of drafted review comments before publish, dropping anything low-value, sitting directly in the tool-call path so it can't be skipped.
- **Reply Critic** — the same screening applied to discussion replies.
- **Draft Integrity** — validates a draft's diff position before it's created, and independently verifies after publish that it actually landed in the discussion — GitLab's own publish response isn't trusted in either direction, since it's been observed unreliable both ways.

## Memory

As the agent works, it flags durable, project-specific facts — conventions, recurring false positives, team decisions — which a curator pass dedups and stores per project, seeding every future review of that project. Chat has its own personal memories, saved and recalled directly by the model as durable facts about the user across conversations.

## Reliability and cost control

- **Model Retry** — some models occasionally emit malformed tool-call syntax mid-call; this retries a few times and reports each attempt, rather than silently faking a final answer.
- **Context Summarization** — trims older history by token budget (not a fixed message count, since a single diff can be 20-70K tokens on its own), preserving only the most recent call per tool so a long-running todo list doesn't get lost to summarization.
- **Tool Output Cap** — a hard character ceiling on any single tool's raw output, a backstop against one oversized result blowing past the context budget on its own.
- **LLM Backend Limiter** — per-provider concurrency limiting, so a burst of runs doesn't overwhelm whatever backend (OpenRouter, Ollama, sglang) is configured.
