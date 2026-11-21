```
git_diff
```

Returns the MR's full patch in one call. Very large diffs (lockfiles,
generated files, vendored code) come back capped — the result names the
files it had to leave out, if any; fetch those individually with
`git_file_diff` (same params, plus a required `path`) instead of retrying
`git_diff` hoping for more.

If Step 2 found prior versions, scope down instead of re-reading the full
diff: call `list_merge_request_versions`, find the version whose
`created_at` lines up with the start of the last review round, and pass its
`head_commit_sha` as `base` to `git_diff`/`git_changed_files`:

```
git_diff
  base: "<head_commit_sha of the last-reviewed version>"
```

This diffs just what changed since that push, through to the current HEAD,
instead of the whole MR. Focus the diff review on what changed since that
round.
