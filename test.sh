#!/usr/bin/env bash
# Trigger test webhook events against the local backend, attributed to your-gitlab-username.
# Run: ./test.sh
# Override host: HOST=https://your-host.com ./test.sh

cd "$(dirname "$0")"

BACKEND_NODE_ENV="$(grep -m1 -E '^NODE_ENV=' backend/.env 2>/dev/null | cut -d= -f2-)"
if [ "$BACKEND_NODE_ENV" != "development" ]; then
  echo "Refusing to run: backend/.env NODE_ENV='$BACKEND_NODE_ENV' (expected 'development'). This looks like prod." >&2
  exit 1
fi

HOST="${HOST:-http://localhost:3698}"
URL="$HOST/webhooks/gitlab"
PROJECT="your-namespace/your-project"
BOT_USERNAME="$(grep -m1 -E '^GITLAB_BOT_USERNAME=' backend/.env 2>/dev/null | cut -d= -f2-)"

trigger_mr() {
  local label="$1"
  local iid="$2"
  local source_branch="$3"
  local target_branch="$4"
  local action="${5:-open}"
  local draft="${6:-false}"
  local oldrev="${7:-}"
  local last_commit_sha="${8:-}"

  local oldrev_field=""
  if [ -n "$oldrev" ]; then
    oldrev_field="\"oldrev\": \"$oldrev\","
  fi

  local last_commit_field=""
  if [ -n "$last_commit_sha" ]; then
    last_commit_field="\"last_commit\": { \"id\": \"$last_commit_sha\" },"
  fi

  local draft_suffix=""
  [ "$draft" = "true" ] && draft_suffix=", draft"
  echo "→ $label (!$iid) [$action$draft_suffix] [$source_branch → $target_branch]"
  curl -s -o /dev/null -w "  %{http_code}\n" \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-Gitlab-Event: Merge Request Hook" \
    -d "{
      \"object_kind\": \"merge_request\",
      \"object_attributes\": {
        \"iid\": $iid,
        \"action\": \"$action\",
        \"draft\": $draft,
        $oldrev_field
        $last_commit_field
        \"source_branch\": \"$source_branch\",
        \"target_branch\": \"$target_branch\"
      },
      \"project\": {
        \"path_with_namespace\": \"$PROJECT\",
        \"default_branch\": \"dev\"
      }
    }"
}

trigger_issue() {
  local label="$1"
  local iid="$2"
  local title="$3"
  local action="${4:-update}"

  echo "→ $label (#$iid) [$action, assigned to \$GITLAB_BOT_USERNAME]"
  curl -s -o /dev/null -w "  %{http_code}\n" \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-Gitlab-Event: Issue Hook" \
    -d "{
      \"object_kind\": \"issue\",
      \"user\": { \"username\": \"your-gitlab-username\" },
      \"object_attributes\": {
        \"iid\": $iid,
        \"action\": \"$action\",
        \"title\": \"$title\",
        \"description\": \"Test issue triggered from test.sh.\"
      },
      \"changes\": {
        \"assignees\": { \"previous\": [], \"current\": [{ \"username\": \"$BOT_USERNAME\" }] }
      },
      \"assignees\": [{ \"username\": \"$BOT_USERNAME\" }],
      \"project\": {
        \"path_with_namespace\": \"$PROJECT\",
        \"default_branch\": \"dev\"
      }
    }"
}

trigger_note() {
  local label="$1"
  local note_id="$2"
  local mr_iid="$3"
  local note_body="$4"
  local system="${5:-false}"
  local noteable_type="${6:-MergeRequest}"

  echo "→ $label (note $note_id on !$mr_iid) [system=$system]"
  curl -s -o /dev/null -w "  %{http_code}\n" \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-Gitlab-Event: Note Hook" \
    -d "{
      \"object_kind\": \"note\",
      \"user\": { \"username\": \"your-gitlab-username\" },
      \"object_attributes\": {
        \"id\": $note_id,
        \"note\": \"$note_body\",
        \"noteable_type\": \"$noteable_type\",
        \"system\": $system
      },
      \"merge_request\": { \"iid\": \"$mr_iid\" },
      \"project\": {
        \"path_with_namespace\": \"$PROJECT\",
        \"default_branch\": \"dev\"
      }
    }"
}

# ── issue-assignment trigger (§1) — real issue from this repo ──

# 6. bot assigned to #45 (small, self-contained refactor task) → work-item-resolve enqueued
trigger_issue "work-item-resolve:assign" 45 "[REFACTOR] Extract shared GitLab fetch client"

# ── comment re-trigger (§6) — needs a thread whose metadata.mrIid matches; run
# the issue trigger above and let a real run open an MR first, then substitute
# its iid below, or expect 'no_matching_work_item_resolve_thread' against a mismatch ──

# 7. plain MR comment → re-enqueues work-item-resolve if a matching thread exists
trigger_note "work-item-resolve:comment" 500001 "mock-mr-iid-45" "Do we need a separate notesUrl function since that's not being reused? Maybe we can collapse it into the callee?"

# 8. system note (e.g. "changed the description") → skipped, never a trigger
trigger_note "work-item-resolve:system-note" 500002 96 "changed the description" "true"

# 9. non-MR note (e.g. on an issue) → skipped, out of scope for this workflow
trigger_note "work-item-resolve:issue-note" 500003 96 "not a merge request comment" "false" "Issue"

# ── 5 test cases, each a real MR from your-namespace/your-project, one per filter/action path ──

# 1. exclude_branches: source matches "feat/repo-*" → skipped (no review)
trigger_mr "exclude:source-match" 45 "feat/repo-instructions" "dev" "open" "false" "" "a5e06eb4300de4425b53050955ccc498cbebb6df"

# 2. no exclude match, initial open → reviewed (!90, has .ts changes)
trigger_mr "review:source-no-match" 90 "feat/improve-summarization-and-critic-observability" "dev" "open" "false" "" "eee2d7cdac68f4a759335f21073b2e84b89d9939"

# 3. stable branch pattern: dev → master promotion merge → skipped (!94)
trigger_mr "skip:stable-branch" 94 "dev" "master" "open" "false" "" "7c7338c501e7a9e7e3a073db03d9a0c2edbb0a91"

# 4. update + oldrev → re-review of an already-open MR (!87)
trigger_mr "re-review:update-oldrev" 87 "fix/critic-ollama-structured-output-and-tool-cache-errors" "dev" "update" "false" "9218258484eda885fce5a6700c58b284e63e2175" "9218258484eda885fce5a6700c58b284e63e2175"

# 5. draft MR → skipped before any filter runs (!82)
trigger_mr "skip:draft-mr" 82 "feat/draft-comments-critic" "dev" "open" "true" "" "fc1212abafeca8f9b4b2bf16b6b49432667429a3"

echo ""
echo "Done."