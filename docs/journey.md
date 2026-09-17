# The Story So Far

This page is the "why" and "how it got here" that the reference docs don't have room for — mined from the real commit history, written fresh rather than reproduced from it.

## An MR-review bot, first

The first two weeks (June 2026) were almost entirely about the plumbing a review bot needs before it's trustworthy enough to comment on real code: a webhook endpoint with proper HMAC signature verification, a queue so a burst of pushes doesn't trigger a review storm, retry logic for a job worker that occasionally crashed mid-run, and a handful of very boring but very necessary correctness fixes — skip review for a promotion merge, don't review a draft MR, don't let a stalled queue job silently disappear. None of it was glamorous. All of it had to exist before the agent's own output mattered at all.

## Learning to read before learning to write

The next stretch was about giving the agent enough context to be worth listening to. Local git tools (diff, changed-files, grep, read) got wired directly into the workflow so the agent could look at the actual worktree, not just GitLab's API view of a diff. Long-term project memories showed up around the same time — the realization that a review bot reviewing the same project every week should stop re-learning the same conventions from scratch. And because feeding an LLM an entire large diff plus its own tool call history reliably blows a context window, auto context-summarization landed early and stayed load-bearing ever since.

The first real guardrail — screening draft comments before they publish — also showed up here. It turns out an LLM reviewing code will occasionally draft a comment a senior engineer would roll their eyes at, and the fix isn't a better prompt, it's a second pass that's allowed to just drop the comment.

## From read-only to interactive

August is when this stopped being purely a background reviewer. GitLab OAuth login, a settings page, per-user encrypted API keys, and a full Chat interface arrived in the same few weeks — the agent went from "posts comments no one asked for in real time" to something you could actually have a conversation with, with its own memory, its own search tools over past reviews and past chats, and human-in-the-loop approval for anything that needed a second opinion before it ran.

Analytics landed right alongside it, and not as an afterthought — comment acceptance rate specifically, tracked by capturing whether a human ever resolved the bot's own comments, exists because "does anyone actually act on what this bot says" is a more honest question than "did it run successfully."

## From commenting to acting

The biggest architectural jump was giving the agent somewhere safe to actually make changes — not just comment on them. That meant sandboxed execution, which meant a real container-isolation story (this is where the Kata runtime work started, and where most of the operational war stories in the [deployment doc](/deployment) come from — a shared Docker socket, a bridge interface collision, an egress model that turned out not to fully work under a Docker backend and got documented as a known gap rather than quietly ignored). Issue-resolve — assign an issue, get a draft MR — came out of that sandboxing work, and task-resolve (a free-text instruction instead of a GitLab issue) followed shortly after, along with the ability to schedule either one to run on a recurring basis.

## Guardrails, earned one at a time

None of the guardrails documented on the [Features page](/features) arrived as a planned suite. Each one exists because a specific run misbehaved in a specific way that was worth catching generically: a run that quietly repeated the same failing tool call, a run that ended on an unanswered question instead of finishing, a run that never checked for new review feedback before wrapping up, a run stuck in a genuine repetition loop that needed a hard abort rather than an infinite nudge. The pattern held throughout — notice a real failure mode, write the narrowest possible backstop for it, keep the system prompt as the actual source of truth for correct behavior.

## Where it is now

Four workflows (MR review, issue resolution, task resolution, chat), a durable memory system, a guardrail and quality-control layer earned through actual failures rather than designed up front, and enough operational scar tissue from running sandboxed execution in production to fill a deployment doc most projects wouldn't bother writing. That's what's here — and it's still being built.
