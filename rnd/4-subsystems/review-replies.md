# langgraph-harness — Review Replies

> **Domain owned by this document:** how langgraph-harness **interprets and responds to developer activity on
> review discussion threads** — replies, comment edits, and resolutions — during re-review.
> Nothing else.
>
> **No architecture here.** Triggers, the per-MR thread, execution, and locking are **not**
> defined in this document — see **[Platform Architecture → §6.4 MR Interaction Model](../3-architecture/platform-architecture.md#64-mr-interaction-model-review-replies)**
> and **[§5 Execution Model](../3-architecture/platform-architecture.md#5-execution-model)**. Shared concepts
> (_Thread_, _Run_, _Event_, _Workflow_) are defined in
> **[§3 Core Concepts](../3-architecture/platform-architecture.md#3-core-concepts)**. See Platform Architecture.
>
> The **procedure** the agent follows is the `code-review` skill
> (`backend/src/skills/gitlab-mcp/code-review.md`). This document is the _rationale_ behind the
> reply-handling behaviour in that skill.

## What a review reply is

After langgraph-harness posts review comments, the developer responds on a discussion thread by either:

- **fixing the code** the comment flagged, or
- **replying on the thread** where no code change is needed (an explanation, a question, or
  pushback), or
- **resolving the thread** manually.

Re-review (triggered by a push — see Platform Architecture) must account for all three.

## Reply-handling principles

- **Replies and edits are read, not triggers.** A reply changes nothing on its own; it is read at
  the next push re-review. langgraph-harness does not schedule work per discussion. (See §6.4.)
- **GitLab is the source of truth.** langgraph-harness stores minimal metadata and fetches the current
  discussion state on each run, so edited, deleted, and force-pushed content is handled naturally
  without replaying webhook payloads.
- **A reply can address a concern by itself** — an explanation ("intentional, handled elsewhere,
  out of scope") is as valid as a code change. The diff alone will not surface a reply-only
  thread, so the current discussion must be read directly.

## What the agent does with each open thread (on re-review)

Weigh the developer's reply **and** the code:

```
if the developer replied:
    reply addresses the concern (valid explanation / fix confirmed / agreed out of scope) → resolve thread
    reply asks a question or needs a response                                             → reply on thread
    reply pushes back but the concern still stands                                        → reply explaining why
elif the flagged code changed:
    removed entirely → judge intent (correct fix → resolve; deleted instead of fixed → reply, no new inline thread)
    otherwise        → check adequacy; reply only if the fix is inadequate
else (no reply, no change):
    leave the thread open
```

Then **resolve** the threads judged addressed and **approve/unapprove** the MR. The developer
merges. (Exact tool calls: the `code-review` skill.)

## Edits & resolutions

- **Developer edits a reply** — the latest discussion state is read at the next re-review; no
  special handling.
- **Reviewer edits the original request** (e.g. "Rename foo()" → "Ignore this") — the updated
  conversation is what the agent sees; it responds to the current text.
- **langgraph-harness edits its own comment** — ignored; never a reason to act (prevents recursion).
- **Resolution & merge** — the agent resolves threads it judges addressed; the human merges.

## Superseded designs (historical)

Two earlier designs for this area are **superseded** and intentionally not described here:

- an **event-driven discussion scheduler** (per-discussion `IDLE/DIRTY/RUNNING` state, per-reply
  debounce, unread-note queues), and
- a **`@harness` command-driven** model.

Both were replaced by the coarse-event trigger model (push → re-review), recorded in
**[Platform Architecture → §10, Decision 1](../3-architecture/platform-architecture.md#10-architectural-decisions-resolved-conflicts)**.
