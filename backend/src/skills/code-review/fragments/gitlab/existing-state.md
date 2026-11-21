Always perform this step before fetching diffs or drafting comments.

```
mr_discussions
  project_id: "my-group/my-project"
  mergeRequestIid: 42
  page: 1
  per_page: 100

list_draft_notes
  project_id: "my-group/my-project"
  mergeRequestIid: 42

list_merge_request_versions
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

`mr_discussions` is paginated (GitLab's default is 20 discussions per page, max 100) and does not auto-fetch every page — page through with `page`/`per_page` until a response comes back short of a full page, otherwise threads past the first 20 are silently missed.

**GitLab has no server-side filter for resolved/unresolved discussions** — every discussion, resolved or not, comes back in one interleaved list, and a discussion has no single top-level "resolved" flag — it's computed from its `notes`: a discussion is open if at least one of its notes has `resolvable: true` and `resolved: false`. On an MR with a long history, it's easy to skim past the one open thread buried among many already-resolved ones. Don't eyeball it — walk every discussion in the response and explicitly classify it (open vs resolved) by checking its notes, and record the open ones as a list (discussion_id, file, line) before moving on. That list is what Step 4 cross-references against.

- **No open or resolved discussions, no prior versions** — this is genuinely a first pass. Everything gets reviewed fresh.
- **Open discussions and/or prior versions exist** — someone (human or a previous AI pass) has already been through this MR. Cross-reference each file's changes against that existing state (Step 4) instead of re-flagging concerns already tracked by an open thread — but code with no corresponding thread still gets reviewed fresh, same as a first pass.

**Duplicate threads** — a reply that didn't thread correctly can leave more than one open thread pointing at the same underlying issue. If more than one open thread covers the same concern, resolve every one of them **except the most recent, right now, in this step** — call `resolve_merge_request_thread` on each older duplicate before moving on. Do not defer this to Step 7: by the time you get there, several tool calls later, it's easy to only remember and act on part of the duplicate list you built here. Only the most recent thread per concern should still be open when you leave this step — recheck your own list against the full thread list before proceeding, since a concern can have more than two duplicates.

This compounds fast if skipped: one real MR left a single unaddressed `useEffect` cleanup finding with 4 separate "not addressed in this version" top-level notes (one per re-review round), and an unsafe-cast finding on the same MR had 5. None carried a `position` and none shared the original finding's `discussion_id` — each was a fresh, unlinked duplicate rather than a reply. Left unresolved, every later round has to wade through more noise to find the one thread that still matters.

Record the existing open discussions and pending drafts. They will be used during Step 4 and Step 6.
