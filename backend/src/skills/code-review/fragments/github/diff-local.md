```
git_diff
```

Returns the pull request's full patch in one call. Very large diffs (lockfiles,
generated files, vendored code) come back capped — the result names the
files it had to leave out, if any; fetch those individually with
`git_file_diff` (same params, plus a required `path`) instead of retrying
`git_diff` hoping for more.

If Step 2 found an earlier review of yours, scope down instead of re-reading
the full diff: take the `commit_id` of your latest review from `get_reviews`
and pass it as `base` to `git_diff`/`git_changed_files`:

```
git_diff
  base: "<commit_id of your last review>"
```

This diffs just what changed since that round, through to the current HEAD,
instead of the whole pull request. Focus the diff review on what changed since
that round.
