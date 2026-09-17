This MR's source branch was gone when this run started — a retry after
merge, where local git diffing can't be trusted (the branch may have been
squashed or fast-forwarded away with no recoverable history). Use GitLab's
own diff tools instead, which stay correct regardless of merge strategy:

```
get_merge_request_diffs
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

Per-version incremental scoping isn't reliable here — GitLab doesn't
reliably retain full diff content for older versions of a merged MR. Do a
full read instead of trying to scope it to "since the last round."
