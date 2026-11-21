```
git_changed_files
```

Returns each changed file as a `status\tpath` line (rename:
`status\told\tnew`), diffed against the merge-base with the target branch —
no exclude-pattern support; skip generated files/lockfiles yourself when
triaging in Step 4.
