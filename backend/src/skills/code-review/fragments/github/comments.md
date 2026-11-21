GitHub publishes inline comments as one review. Create a pending review, add each comment to it, and leave it pending — Step 8 submits it, which is what publishes the comments. Only create the pending review once you have at least one comment or reply to post.

```
pull_request_review_write
  method: "create"          # no event — an event would submit an empty review right away
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42

add_comment_to_pending_review
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  body: "Your comment here"
  subjectType: "LINE"
  path: "src/api.ts"
  line: 42
  side: "RIGHT"             # "RIGHT" for added or unchanged lines, "LEFT" for removed lines

... repeat for each finding ...
```

GitHub allows one pending review per account per pull request. If `create` fails because one already exists, it's left over from an interrupted run — discard it with `method: "delete_pending"` and create again.

**Line number rules:**

- `side: "RIGHT"` — added (`+`) or unchanged context lines; use the line number from the `+` side of the diff
- `side: "LEFT"` — removed (`-`) lines; use the line number from the `-` side of the diff

A line that isn't on the given side of the diff is checked automatically and rejected with the specific reason — re-read the diff for that line and retry with a corrected `line`/`side`.

**Multi-line (ranged) comments** — set `startLine` (and `startSide`, if it differs) to the first line of the block; `line` is the last:

```
add_comment_to_pending_review
  ...
  startLine: 45
  startSide: "RIGHT"
  line: 50
  side: "RIGHT"
```

**Replying on a carried-over thread** — this only applies to the "attempted fix that's still inadequate" case from Step 4. Reply on the existing thread so the conversation stays threaded, explaining specifically what the new attempt still gets wrong (not a restatement of the original concern):

```
add_reply_to_pull_request_comment
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  commentId: 123456        # the thread's first comment — the number after #discussion_r in its html_url
  body: "What the new attempt still gets wrong"
```

A reply needs no line, so it also covers Step 4's dead-code case, where the flagged code was deleted entirely. It's held and posted together with the review when Step 8 submits it. This is the only case where you reply on a carried-over thread — untouched code (Step 4) is never worth a reply, no matter how many rounds it's been open.

**New issue in genuinely new code** — whether it's new code in a first pass or new code alongside carried-over threads, add a fresh inline comment as above.

**The submitted review's own result is checked for you.** When Step 8 submits, its result carries a `verification` field (`confirmedInReviewThreads`, `notYetConfirmed`) checked live against `get_review_comments` — trust that over the call's own success status. Post anything in `notYetConfirmed` again in a new pending review (`create`, `add_comment_to_pending_review`, then `submit_pending`); if it's still unconfirmed after a retry, say so plainly in your final summary rather than reporting the review as fully posted.

Only comment on specific lines that have concrete, actionable issues — **do not post general pull request overviews, summaries of what's done well, or praise comments**. This applies to the review's own `body` too — leave it unset when submitting rather than filling it with a recap of the review outcome. This also rules out hedged observations you don't actually believe are problems — "worth being aware of", "likely fine for now, but", "just flagging" — if your own finding says it's not an issue, don't post it. Only speak up when you'd want the author to change something.

**If triage found nothing to say** — no inadequate-fix replies, no new issues, only untouched carried-over threads — do not post anything. Do not post a general comment (`add_issue_comment`, a review `body`, etc.) recapping the status of every original thread ("issue #1 addressed, issue #2 no longer relevant, ..."). That recap is redundant with the thread resolutions from Step 7, which already show each issue as resolved in the pull request UI. Silently resolve and approve (Steps 7–8); only speak up when there's a concrete, actionable concern the author needs to act on.

**Never comment on CI/check status** (passing, failing, running, etc.), even though `pull_request_read` can surface it (`get_status`, `get_check_runs`). That only tells you _that_ a check failed, not _why_ — there's no exposed tool for job logs or failure traces, so there's nothing actionable to say about it anyway. GitHub already shows the status natively in the pull request UI, so restating it is pure noise. Ignore check status entirely when reviewing.
