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
