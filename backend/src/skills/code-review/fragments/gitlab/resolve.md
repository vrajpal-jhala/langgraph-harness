For each open thread that the author has addressed (older duplicate threads should already be resolved — see Step 2):

```
resolve_merge_request_thread
  project_id: "my-group/my-project"
  mergeRequestIid: 42
  discussion_id: "abc123"
  resolved: true
```

To reopen a resolved thread whose concern genuinely regressed (Step 4), call `resolve_merge_request_thread` on it with `resolved: false`.
