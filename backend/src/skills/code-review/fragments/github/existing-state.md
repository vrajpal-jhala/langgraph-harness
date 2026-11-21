Always perform this step before fetching diffs or drafting comments.

```
pull_request_read
  method: "get_review_comments"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  perPage: 100

pull_request_read
  method: "get_reviews"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42

pull_request_read
  method: "get_comments"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
```

`get_review_comments` returns the pull request's review threads — each with an `id` (`PRRT_...`), `is_resolved`, `is_outdated`, and its `comments` (`path`, `line`, `author`, `created_at`, `html_url`). It's paginated by cursor and does not auto-fetch every page — while `pageInfo.hasNextPage` is true, call it again with `after` set to `pageInfo.endCursor`, otherwise threads past the first page are silently missed.

Every thread, resolved or not, comes back in one interleaved list. On a pull request with a long history, it's easy to skim past the one open thread buried among many already-resolved ones. Don't eyeball it — walk every thread in the response, classify it by `is_resolved`, and record the open ones as a list (thread `id`, file, line, and the numeric id of its first comment — the number after `#discussion_r` in that comment's `html_url`, which is what a reply needs) before moving on. That list is what Step 4 cross-references against.

`get_reviews` lists earlier review rounds (`user`, `state`, `commit_id`, `submitted_at`) — yours included, as `{{BOT_USERNAME}}`. `get_comments` lists the general conversation comments; ignore your own status comment there (the one with the langgraph-harness footer).

- **No review threads and no earlier reviews** — this is genuinely a first pass. Everything gets reviewed fresh.
- **Open threads and/or earlier reviews exist** — someone (human or a previous AI pass) has already been through this pull request. Cross-reference each file's changes against that existing state (Step 4) instead of re-flagging concerns already tracked by an open thread — but code with no corresponding thread still gets reviewed fresh, same as a first pass.

**Duplicate threads** — more than one open thread can point at the same underlying issue. If more than one open thread covers the same concern, resolve every one of them **except the most recent, right now, in this step** — call `pull_request_review_write` with `method: "resolve_thread"` and that thread's `threadId` on each older duplicate before moving on. Do not defer this to Step 7: by the time you get there, several tool calls later, it's easy to only remember and act on part of the duplicate list you built here. Only the most recent thread per concern should still be open when you leave this step — recheck your own list against the full thread list before proceeding, since a concern can have more than two duplicates.

Record the existing open threads. They will be used during Step 4 and Step 6.
