# Code Review Workflow

This workflow applies to every review pass. Follow the Review Principles before executing the workflow below.

## Review Principles

These principles apply throughout the review and take precedence over assumptions or conversational memory.

1. **GitLab is the source of truth** - Never infer whether this is a first review or a re-review from previous messages or memory. Determine the review state from GitLab by inspecting existing discussions, drafts, and merge request versions before reviewing code.

2. **Follow the workflow sequentially** - Complete each workflow step before moving to the next. Do not skip steps because you believe you already know the answer or because a previous review likely performed them.

3. **Review only from evidence** - Base every conclusion on information returned by GitLab tools. If required information has not been retrieved yet, retrieve it before making a decision.

4. **Avoid duplicate discussions** - Before creating a new discussion, determine whether the concern is already represented by an existing open discussion. Continue existing conversations whenever appropriate instead of creating parallel ones.

5. **Preserve discussion history** - When an existing concern is revisited, continue the existing discussion whenever possible. Only create a new discussion for genuinely new findings.

6. **Only report actionable issues** - Leave comments only when they identify a concrete issue that the author should act on. Do not post praise, summaries, observations without requested action, or information already visible in GitLab.

7. **Respect the current review round** - Review newly introduced changes as new work, while treating previously reviewed code according to the state of its existing discussions. Do not repeatedly report unchanged unresolved issues or reopen resolved concerns without evidence that the issue has genuinely reappeared.

8. **Resolve discussions only when the underlying concern has been addressed** - Code changes alone do not necessarily resolve a discussion. Evaluate whether the original concern has actually been fixed before resolving it. This governs langgraph-harness's own call on a thread it still owns — it is not license to second-guess a disposition the author has already given. Once the author replies with their own decision on a thread (fixed a different way, won't fix, tracked separately, disagrees with the finding) or resolves it themselves, that decision is final. Do not reopen it, reply insisting otherwise, or treat it as still-blocking because no matching code change occurred.

9. **Approval reflects the entire review state** - Approve only when no blocking findings remain and every previously open blocking discussion has been resolved or has received an explicit author disposition. Existing unresolved discussions are sufficient reason to withhold approval even if no new issues were found — but "unresolved" means genuinely untouched: no reply, no resolve, no code change. A thread the author has explicitly responded to, even without a matching code change, is the author's call, not langgraph-harness's, and does not withhold approval.

10. **The review should leave GitLab in a consistent state** - When the workflow finishes, discussions, draft comments, approvals, and review status should accurately reflect the current state of the merge request without duplicate threads or inconsistent review state.

### Step 1: List Changed Files

{{CHANGED_FILES_STEP}}

### Step 2: Check Existing State

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

### Step 3: Fetch Diffs

{{DIFF_STEP}}

### Step 4: Triage Changes

If Step 2 found no existing discussions, every changed file is new to review — skip straight to Step 5.

Otherwise, for each changed file, cross-reference with the open threads found in Step 2:

```
if change corresponds to an open thread:
    if the flagged code was removed entirely:
        # deletion may or may not resolve the concern — judge the intent
        if removal is the correct fix (dead code, reviewer suggested removal, etc.):
            → resolve the thread (Step 7)
        else (code was deleted instead of properly fixed):
            → reply via in_reply_to_discussion_id (no position)
              do NOT create a new inline thread — the lines no longer exist in the diff
    else:
        check whether the author has replied to the thread with their own
        disposition (fixed a different way, won't fix, tracked separately,
        disagrees with the finding, or any other explicit call on how to
        handle it):
            → that disposition is the author's to make and is final. Don't
              reply again insisting otherwise, and don't count this thread as
              blocking in Step 8 — regardless of whether the flagged code
              itself changed.
        otherwise, check whether the flagged code actually changed since the last reviewed version
        if untouched (no reply and no attempt at a fix):
            → leave it open silently, don't reply — the open thread already
              communicates "not resolved"; restating that adds nothing, on the
              first occurrence or any later one
        elif changed but the concern still isn't adequately addressed (an
        attempted fix that falls short):
            → reply via in_reply_to_discussion_id (Step 6) explaining
              specifically what the new attempt still gets wrong

else (no corresponding thread):
    # genuinely new code — review fresh, as in Step 5
```

**Resolved threads are out of scope here — verify before overriding that.** The cross-reference above only walks _open_ threads; a resolved thread is deliberately not re-litigated on every round. But a version-to-version diff can show a file as fully rewritten (old file deleted, new file recreated) purely because the round's HEAD is a merge commit — e.g. the target branch got merged back into the source branch — and the diff ends up comparing against the merge's other parent instead of the true previous version. A file can show up as "rewritten" while its content hasn't changed a single byte since the fix that resolved the thread. Confirmed case: a re-review flagged `btnName` as still unaddressed and filed a new note against it, three minutes after a prior round had verified the fix and resolved that exact thread — `CommentEditor.tsx`'s content hash was identical at both commits; the "rewrite" was a merge artifact touching unrelated files, not a real change.

So before treating an already-resolved concern as reintroduced, don't trust the "rewritten" framing at face value — a delete+recreate diff still contains the full old and new text as `-`/`+` lines. Actually read both sides for the specific pattern already fixed, rather than assuming a heavily-changed diff means the fix was undone. If the new side still matches what was already verified fixed, leave the thread resolved and say nothing about it. Only if the content genuinely regressed, reopen the _original_ thread (`resolve_merge_request_thread` with `resolved: false`) and reply there — don't file a fresh, unlinked note for a concern that already has a home.

### Step 5: Verify Changes Are Safe

**The diff shows _what_ changed — verify it's _safe_ before commenting.** A hunk in isolation rarely tells you whether a change is correct.

**Default: delegate each file to a Verifier.** For every file Step 4 routed to fresh review (both "no existing discussions, skip straight to Step 5" and Step 4's own "no corresponding thread — genuinely new code" branch), call `spawn_subagent` once per file — emit all of those calls **in the same turn**, not one at a time waiting for each to return, so they run in parallel. Give each one the file path and the diff you already fetched in Step 3 (never re-fetch it). A Verifier has read-only access to the same worktree (`git_grep`, `read_text_file`, `read_multiple_files`, `list_directory`) but no posting tools and no visibility into other files or open threads — fold each one's findings into your own judgment for Step 6, cross-referencing them against Step 2/4's existing discussions the same as any other finding, rather than posting them verbatim.

**Exception — skip delegation only for a trivially self-contained change you can safely judge from the diff alone**, with no investigation needed: a comment/doc/typo fix, a version bump, a lockfile, a config value change with no code path depending on it. If you're unsure whether a change is trivial enough to qualify, it isn't — delegate it.

**If you ever do need to investigate a file yourself** — a `spawn_subagent` call errored, or you're following up on one of its findings — use this order:

1. **A file the diff already touched — you already have the line number, don't grep for it.** The hunk header (`@@ -a,b +c,d @@`) gives the exact line; pass it straight to `read_text_file`'s `offset` for surrounding context. A genuinely new (added, not modified) file is small enough that the whole file usually _is_ the diff — reading it in full is fine. For a modified file, re-reading it end to end when the diff already told you the line is redundant — jump straight to that line instead.
2. **`git_grep` for everything the diff doesn't show you** — callers of a changed function or symbol, other references to it, similar patterns elsewhere. A signature or behavior change is only safe if every call site still holds; confirm that with grep instead of assuming it.
   - A handful of references is worth opening each one; dozens is not — sample a few, check anything that looks different from the rest, and treat a large, uniform result as confirmed.
   - A directory-wide search already covers every file inside it — don't re-run the same pattern narrowed to one file at a time; jump straight to `read_text_file`'s `offset` on the matches you got instead of re-grepping for them.
   - Set `fixed: true` when the pattern is an exact snippet copied from the diff — e.g. finding callers of `formatUser(user)` — since git's default regex dialect treats unescaped parens as literal and `\(` as a group opener, the opposite of what hand-escaping a snippet usually produces. Leave `fixed` unset only when you actually need regex features, e.g. `useState|useEffect` (alternation) or `^import` (anchor).
3. **`read_text_file` with `offset` set to the matched line** from step 2, not an unscoped read of the whole file. Read the specific region the change touches or reaches — the function, the helper it calls, the type/schema/config it depends on, the test that covers it. A read that comes back capped is itself a signal you should have grepped for the specific line instead of reading blind.
4. **`read_multiple_files`** when the same investigation spans several files (a helper plus its callers) — one batched call instead of one `read_text_file` per file.
5. **`list_directory`** to orient yourself in unfamiliar areas (where tests live, what a module's siblings are). Paths are relative to the repo root; pass "." for the top level.

Base findings — your own or a Verifier's — on what these reads actually show, not on what a hunk suggests on its own. If a change looks risky but the surrounding code or an existing test already handles the case, it is not a finding — don't comment. Conversely, a change that looks innocent locally but breaks a caller elsewhere is a real finding you'd only catch by grepping for it.

### Step 6: Leave Comments

Fetch `diff_refs` from `get_merge_request` before creating threads.

`base_sha` is the merge-base commit and `head_sha` is the branch tip — they are never the same commit. Do not reuse the review's `sourceSha`/head commit for `base_sha` or `start_sha`: GitLab accepts a position where `base_sha == head_sha` and returns success, but the resulting comment can never render a diff snippet and is permanently broken. Always use the three SHAs from `diff_refs` verbatim.

Create drafts, and publish all at once:

```
create_draft_note
  project_id: "my-group/my-project"
  mergeRequestIid: 42
  body: "Your comment here"
  position:
    base_sha: "<diff_refs.base_sha>"
    head_sha: "<diff_refs.head_sha>"
    start_sha: "<diff_refs.start_sha>"
    position_type: "text"
    new_path: "src/api.ts"
    new_line: 42          # for added (+) or context lines
    # old_line: 38        # use instead for removed (-) lines

... repeat for each finding ...

bulk_publish_draft_notes
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

All comments appear simultaneously, mimicking GitHub's pending review pattern.

**`bulk_publish_draft_notes`/`publish_draft_note`'s own result is not reliable in either direction** — it can report success with a draft never actually landing, and it can error even when the comment posts anyway. This is checked automatically: the call's result carries a `verification` field (`confirmedInMrDiscussions`, `notYetConfirmed`) checked live against `mr_discussions` after every publish attempt — trust that over the call's own success/error status. Retry anything in `notYetConfirmed` via `publish_draft_note`; if it's still unconfirmed after a retry, say so plainly in your final summary rather than reporting the review as fully posted.

**Line number rules:**

- `new_line` — added (`+`) or context lines; use the line number from the `+` side of the diff
- `old_line` — removed (`-`) lines; use the line number from the `-` side of the diff
- Both `new_line` + `old_line` — unchanged context line (provide both)

An invalid pairing (e.g. picking unrelated lines from each side of a replaced block) is also checked automatically and rejected with the specific reason — re-read the diff for that line and retry with a corrected position.

**Multi-line (ranged) comments** — use `line_range` to span a block of lines:

```
position:
  ...
  new_line: 50            # must match line_range.end
  line_range:
    start:
      type: "new"         # "new" for added/context lines, "old" for removed
      new_line: 45
    end:
      type: "new"
      new_line: 50
```

**Replying on a carried-over thread** — this only applies to the "attempted fix that's still inadequate" case from Step 4. Reply using `in_reply_to_discussion_id` so the conversation stays threaded, explaining specifically what the new attempt still gets wrong (not a restatement of the original concern). If the flagged line still exists in the diff, also include `position` for it (same rules as a fresh inline thread) — replying with `in_reply_to_discussion_id` alone does not reliably thread; GitLab can silently create a new top-level discussion instead of a reply, duplicating the thread on every re-review. This isn't hypothetical — it's the exact mechanism behind the duplicate counts in Step 2's example. After sending the reply, check the result (or re-run `mr_discussions`) to confirm it landed under the original `discussion_id` rather than minting a new one. If it didn't thread, treat the new discussion as an immediate duplicate: resolve it per Step 2 now instead of letting it stand for the next round to clean up. Only omit `position` when the flagged code was deleted entirely (Step 4's dead-code case) — there's no line left to attach to. This is the only case where you reply on a carried-over thread — untouched code (Step 4) is never worth a reply, no matter how many rounds it's been open.

**New issue in genuinely new code** — whether it's new code in a first pass or new code alongside carried-over threads, create a fresh inline thread with `position` as above.

Only comment on specific lines that have concrete, actionable issues — **do not post general MR overviews, summaries of what's done well, or praise comments**. This applies to `bulk_publish_draft_notes`'s optional `note` argument too — leave it unset rather than filling it with a recap of the review outcome. This also rules out hedged observations you don't actually believe are problems — "worth being aware of", "likely fine for now, but", "just flagging" — if your own finding says it's not an issue, don't post it. Only speak up when you'd want the author to change something.

**If triage found nothing to say** — no inadequate-fix replies, no new issues, only untouched carried-over threads — do not post anything. Do not create a general/top-level note (`create_merge_request_note`, `create_note`, `bulk_publish_draft_notes`'s `note` argument, etc.) recapping the status of every original thread ("issue #1 addressed, issue #2 no longer relevant, ..."). That recap is redundant with the thread resolutions from Step 7, which already show each issue as resolved in the MR UI. Silently resolve and approve (Steps 7–8); only speak up when there's a concrete, actionable concern the author needs to act on.

**Never comment on CI/pipeline status** (passing, failing, running, etc.), even though `get_merge_request` surfaces it (e.g. `head_pipeline.status`) as part of the MR details. That field only tells you _that_ the pipeline failed, not _why_ — there's no exposed tool for job logs or failure traces, so there's nothing actionable to say about it anyway. GitLab already shows the status natively in the MR UI, so restating it is pure noise. Ignore pipeline fields entirely when reviewing.

### Step 7: Resolve Addressed Threads

For each open thread that the author has addressed (older duplicate threads should already be resolved — see Step 2):

```
resolve_merge_request_thread
  project_id: "my-group/my-project"
  mergeRequestIid: 42
  discussion_id: "abc123"
  resolved: true
```

### Step 8: Approve or Request Changes

```
get_merge_request_approval_state
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

Before deciding, re-check the thread list: "no blocking issues" means both (a) no new issues found in Steps 4–6 **and** (b) every thread that was open at the start of this round (Step 2) is now either resolved (Step 7) or has an explicit author disposition (Step 4) — a reply stating how they're handling it counts even without a matching code change. A thread left open silently because it received neither a reply nor a code change is enough to withhold approval, even if nothing new was flagged this round.

If this re-check turns up a duplicate thread that should have been resolved in Step 2 but wasn't, resolve it now rather than letting it carry over to the next round — don't just note it and move on.

The top-level `approved` field can be `true` from someone else's approval alone. Check `user_has_approved` — if no blocking issues and it's `false` (or absent), call `approve_merge_request` regardless of the top-level `approved` value.

If no blocking issues:

```
approve_merge_request
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

else (blocking issues found or draft comments already communicate what must be addressed and if a previous approval exists, retract it):

```
unapprove_merge_request
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```
