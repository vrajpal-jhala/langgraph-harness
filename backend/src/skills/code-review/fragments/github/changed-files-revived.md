```
pull_request_read
  method: "get_files"
  owner: "my-org"
  repo: "my-repo"
  pullNumber: 42
  perPage: 100
```

Returns each changed file's `filename`, `status` (`added`, `modified`,
`removed`, `renamed` — with `previous_filename`) and its `patch`. Page through
with `page` if a pull request changes more than 100 files. Skip generated
files/lockfiles yourself when triaging in Step 4.
