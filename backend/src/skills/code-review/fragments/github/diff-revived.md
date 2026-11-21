This pull request's source branch was gone when this run started — a retry
after merge, where local git diffing can't be trusted (the branch may have been
squashed or fast-forwarded away with no recoverable history). Use GitHub's
own diff instead, which stays correct regardless of merge strategy:

```
pull_request_read
  method: "get_diff"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
```

Each file's patch from Step 1's `get_files` result works too, for one file at
a time. Do a full read instead of trying to scope it to "since the last round."
