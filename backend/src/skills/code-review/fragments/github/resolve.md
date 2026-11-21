For each open thread that the author has addressed (older duplicate threads should already be resolved — see Step 2):

```
pull_request_review_write
  method: "resolve_thread"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  threadId: "PRRT_kwDOabc123"
```

To reopen a resolved thread whose concern genuinely regressed (Step 4), call it with `method: "unresolve_thread"` instead.
