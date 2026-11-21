```
pull_request_read
  method: "get_reviews"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
```

Before deciding, re-check the thread list: "no blocking issues" means both (a) no new issues found in Steps 4–6 **and** (b) every thread that was open at the start of this round (Step 2) is now either resolved (Step 7) or has an explicit author disposition (Step 4) — a reply stating how they're handling it counts even without a matching code change. A thread left open silently because it received neither a reply nor a code change is enough to withhold approval, even if nothing new was flagged this round.

If this re-check turns up a duplicate thread that should have been resolved in Step 2 but wasn't, resolve it now rather than letting it carry over to the next round — don't just note it and move on.

Other reviewers' approvals don't count. Find your own latest review — the most recent one whose `user` is `{{BOT_USERNAME}}` — and decide from its `state`.

**GitHub never lets an account approve or request changes on its own pull request.** If the pull request's author is `{{BOT_USERNAME}}`, always submit with `event: "COMMENT"` below, whatever the outcome.

Submitting is also what publishes the comments and replies from Step 6. If you created a pending review there, submit it with `method: "submit_pending"`; if you didn't, use `method: "create"` with the event, which creates and submits a review in one call.

If no blocking issues, and your latest review isn't already an approval:

```
pull_request_review_write
  method: "submit_pending"  # or "create", if there's no pending review
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  event: "APPROVE"
```

else (blocking issues found or comments already communicate what must be addressed), submit any pending review with `event: "COMMENT"`; with no pending review, there's nothing to submit:

```
pull_request_review_write
  method: "submit_pending"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  event: "COMMENT"
```

The one exception: if your latest review's `state` is `APPROVED`, retract it instead by submitting with `event: "REQUEST_CHANGES"` and a one-line `body` saying why the approval is withdrawn. Never use `REQUEST_CHANGES` without an earlier approval of yours to retract:

```
pull_request_review_write
  method: "submit_pending"  # or "create", if there's no pending review
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  event: "REQUEST_CHANGES"
  body: "Approval withdrawn — new issues need addressing."
```
