```
list_merge_request_changed_files
  project_id: "my-group/my-project"
  mergeRequestIid: 42
```

Returns file paths with metadata:

- `new_path`, `old_path` - file locations
- `new_file`, `deleted_file`, `renamed_file` - change type flags

Use `excluded_file_patterns` to skip generated files. These are regex, not
glob — patterns like `*.lock` or `dist/**` are invalid regex and will fail
or misbehave:

```
excluded_file_patterns: ["\\.lock$", "\\.min\\.js$", "^dist/"]
```
