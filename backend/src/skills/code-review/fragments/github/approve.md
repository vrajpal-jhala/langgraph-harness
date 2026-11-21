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

**If you called `submit_review` in Step 6, the review is already submitted — don't submit another.** The rest of this step only applies when Step 6 posted nothing (including when every comment was withheld).

**GitHub never lets an account approve or request changes on its own pull request.** If the pull request's author is `{{BOT_USERNAME}}`, there's nothing to submit here, whatever the outcome.

If no blocking issues, and your latest review isn't already an approval:

```
submit_review
  event: "APPROVE"
```

else (blocking issues remain), there's nothing to submit — with one exception: if your latest review's `state` is `APPROVED`, retract it with a one-line `body` saying why. Never use `REQUEST_CHANGES` without an earlier approval of yours to retract:

```
submit_review
  event: "REQUEST_CHANGES"
  body: "Approval withdrawn — open threads still need addressing."
```
