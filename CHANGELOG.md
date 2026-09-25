# Changelog

All notable changes to langgraph-harness are documented here.

## [Unreleased]

## [0.4.0] - 2026-09-25

### Features

- **The run timeline now shows how long each "Thinking" step took** — previously there was no way to tell how much time the model spent reasoning before acting, for either the main agent or a per-file review sub-agent. Each reasoning step now shows a live-ticking counter while it's still thinking, and its final duration once it's done.

### Fixes

- **Fetching a web page during a review always failed with an unhelpful error** — a configuration issue in Lightpanda, the headless browser langgraph-harness uses to fetch pages, made every fetch fail immediately without a real explanation. Fetching now works, and any future failure will show what actually went wrong.
- **A model stuck repeating itself while reasoning never triggered the safeguard that stops runaway runs** — that safeguard only checked the model's visible answer, so a model looping purely inside its own reasoning (before writing anything visible) could run unbounded instead of being caught, whether in the main agent or a review sub-agent. It now checks the model's reasoning too.
- **An empty box could appear under a "Thinking" step with nothing in it** — a turn that produced only blank lines around a tool call still rendered its (invisible) content as a box, most noticeably on a review sub-agent's own turns. Blank turns no longer render anything.
- **The context-usage number next to a step could show a confusing negative value** — it was computed from a number that also swings with how much the model reasoned on that particular step, rather than from how much the conversation itself actually grew. It's now based on the latter, so the number reliably increases as a review progresses.
- **The loading indicator kept spinning in a finished sub-agent's view** — it tracked whether the review as a whole was still running rather than whether that specific sub-agent had finished, so its transcript looked like it was still working long after it had returned its findings.

---

## [0.3.0] - 2026-09-23

### Features

- **Two new free LLM providers for MR review** — reviews can now run on Google's Gemini or Groq's free-tier models, in addition to OpenRouter, Ollama, and sglang. This option is for MR review only; Chat doesn't support these providers yet.

---

## [0.2.1] - 2026-09-21

### Fixes

- **Aborting a run now actually cancels sandbox creation** — clicking abort while a run's sandbox was still being provisioned previously had no effect; the run's cancellation now reaches sandbox creation, so it stops instead of continuing to provision.

---

## [0.2.0] - 2026-09-21

### Breaking Changes

- **Deploy and dev scripts moved out of the repo root** — `deploy.sh` and `update.sh` now live under `deployment/`, and `test.sh`/`dev.mjs` under `scripts/`. If you're running an existing production server, its SSH `authorized_keys` forced command still points at the old `update.sh` path and pulling this change won't update it — edit it to `deployment/update.sh` before or during your next deploy, or the deploy will fail. A first-time server setup is unaffected, since the setup docs already reference the new path.

---

## [0.1.1] - 2026-09-20

### Fixes

- **Web page fetches no longer leak browser pages** — each fetch left its rendered page open in the shared browser process instead of closing it; pages are now closed after every fetch.
- **Web page fetches no longer hang on the browser's placeholder tab** — fetching a page could land on the browser's inert startup tab, which never loads; it now opens a fresh page for every fetch.
- **Long-running commands now time out** — a command with no explicit timeout could hang indefinitely; it now falls back to a default timeout.
- **Rejected pushes are retried instead of failing** — a push rejected because the branch moved is now retried with an explicit lease rather than erroring out.
- **MR reviewers are read correctly from webhook payloads** — reviewers assigned via the webhook payload were previously missed; they're now picked up correctly.
- **Docs site links and the hero image work when served from a subpath** — home page links and the hero image broke when the site wasn't served from the domain root; they're now prefixed with the site's base path.
- **Status badges and charts use blue instead of teal** for better contrast.
- **Login page glow replaced with a spinning gradient.**

---

## [0.1.0] - 2026-09-15

Initial public release.

---

## Pre-OSS history

The project was developed privately before this public release, under an internal name and version scheme. That history is included below for transparency about the project's actual age and maturity, renumbered here into a sequential 0.0.x series so version numbers stay monotonic; original dates are unchanged. A few entries referencing internal infrastructure/org details have been generalized.

## [0.0.126] - 2026-09-16

### Fixes

- **The memory count badge next to a project in the memories filter could show a cut-off number** — a project with a two- or three-digit memory count could have its badge squeezed by a long project name in the same row, clipping digits off the count. The badge now always stays fully readable regardless of how long the project name is.

---

## [0.0.125] - 2026-09-15

### Fixes

- **The opt-in "only review once assigned" gate checked the wrong GitLab field** — `mr_review_requires_assignment` in the config file looked at an MR's assignees, but assigning someone and requesting their review are different actions in GitLab with different notifications. The key is renamed to `mr_review_requires_reviewer` and now checks reviewers instead, matching how you'd actually ask the bot to review an MR.
- **Retrying a review, or approving/rejecting a paused one, while another run on the same thread was still starting up could fail instead of queuing** — a narrow timing window let the new run slip past the "already running" check and start alongside the in-progress run, so both tried to check out the same merge request's git worktree at once and one failed outright with an "already leased" error. Both actions are now serialized per thread so a duplicate click or request always correctly waits its turn.

---

## [0.0.124] - 2026-09-15

### Fixes

- **A review run could fail outright the moment the model needed to retry a call, instead of the retry just working** — an internal bug made every retry attempt fail immediately, so runs that should have recovered failed within seconds instead.

---

## [0.0.123] - 2026-09-11

### Fixes

- **A failed GitLab sign-in or reconnect could show a raw internal error code as the toast message** (e.g. `internal_server_error`) instead of a readable one — it now falls back to the same friendly message the page already had for this case whenever GitLab/the server doesn't supply a human-readable reason.

---

## [0.0.122] - 2026-09-11

### Fixes

- **A failed GitLab sign-in could fail silently with no error shown** — an internal error during login (for example, a duplicate linked account) redirected to a backend page the app doesn't have, instead of back to the login screen where the failure toast actually renders.

---

## [0.0.121] - 2026-09-10

### Features

- **MR reviews can now delegate per-file verification to isolated sub-agents** — for a multi-file change, each file's diff gets checked by a separate read-only sub-review running in parallel, instead of the main review agent investigating every file itself. This keeps the main review's own context focused on triage and final comments, and the run's timeline now lets you drill into each sub-agent's own investigation separately from the main review.

### Fixes

- **The discussion-check guard could misfire on a response truncated by the token limit** — a truncated model response has no tool calls, which the guard read as "concluded without checking for new comments" and nudged accordingly, wasting a rewrite on an already-truncated response instead of leaving it alone like the other guards do.

---

## [0.0.120] - 2026-09-07

### Fixes

- **Tagging the bot in a comment on a Task Resolve MR didn't trigger a follow-up run** — the reply lookup never matched the MR to its originating thread, whether the MR came from a manual submission or a schedule, so the comment was silently ignored instead of starting a run with it as the new instruction.
- **A Task Resolve or Work Item Resolve run that failed before making any changes left an empty branch behind on GitLab** — it's now cleaned up the same way a successful-but-empty run already was.

---

## [0.0.119] - 2026-09-04

### Fixes

- **A recurring schedule's first run landed a full cycle late** — a weekly schedule set up for the coming Monday would show its next run as the Monday after, and daily/monthly schedules were off by a day/month the same way. The first run now lands on the date and time the schedule actually shows.

---

## [0.0.118] - 2026-09-03

### Features

- **A new Task Resolve workflow lets an admin hand the agent a free-text prompt instead of a GitLab issue** — given a repo URL and instructions, it works in a sandboxed checkout and opens a draft MR, the same way Work Item Resolve does for an assigned issue. Commenting on the draft MR afterward, mentioning the bot, re-runs it against the same branch.
- **Task Resolve can now be scheduled instead of only run on demand** — from the new Schedules page, an admin sets a prompt and repo to run once at a chosen time, or on a repeating daily/weekly/monthly cadence in the project's timezone. Each fire opens a fresh draft MR exactly like a manual run, with its own run history and pause/resume/cancel controls.
- **Sandboxed workflows (Task Resolve, Work Item Resolve) can now fetch and read web pages** — the agent can pull in outside documentation or reference pages mid-run, the same SSRF-guarded fetch tool Chat already had.

### Fixes

- **Work Item Resolve (and now Task Resolve) could open an empty draft MR when the agent made no actual changes** — the branch is abandoned instead, with no MR opened at all.
- **A repo touched by a sandboxed Task Resolve / Work Item Resolve run in dev could later fail to fetch with a permission error** — the sandbox always writes as root, which could leave files behind that the locally-run backend then couldn't touch. Those writes are now handed back to the backend's own user as soon as the sandbox finishes.

---

## [0.0.117] - 2026-09-01

### Fixes

- **Reconnecting your GitLab account in Settings still showed "Connection expired," even right after reconnecting successfully** — the status check itself was broken, so it never actually reflected whether the connection was still valid. It now shows the real connection status.

---

## [0.0.116] - 2026-08-31

### Features

- **The bot can now be told to only review MRs it's explicitly assigned to** — a new `mr_review_requires_assignment` key in the config file (off by default) skips a repo's automatic review unless the bot's account is one of the MR's assignees; assigning it later, with no new commit, still triggers a first review.

---

## [0.0.115] - 2026-08-31

### Features

- **The monitoring page now flags unreachable sandboxes** — when part of the sandbox fleet doesn't respond to a health check, it now shows how many of the total were actually reachable instead of silently folding them into the totals as if they weren't there.

### Fixes

- **A failure in one part of the monitoring page could blank out the whole thing** — sandbox fleet, compose stack, and disk usage are now fetched, rendered, and reported on independently, so one unavailable resource no longer hides the others behind a page of zeros.
- **Work item threads posted a brand new comment on every run instead of updating the existing one** — retries and re-triggered runs now update the same status comment instead of piling up duplicate comments and notifications.
- **The work-item thread's issue link routed through GitLab's old issue URL first** — it now links directly to the work item page, skipping that redirect.

---

## [0.0.114] - 2026-08-30

### Features

- **A new admin-only Monitoring page shows a live snapshot of the whole deployment's resource usage** — sandbox fleet CPU/memory, per-container stats for the rest of the compose stack (backend, sandbox runtime, memory server, headless browser, Postgres, Redis), and disk usage per data directory. It's fetched fresh each time the page loads, with no auto-refresh, and runs through its own isolated service so the main app never needs direct access to the Docker host.
- **`npm run dev` now stops the local Docker stack when you exit** — previously, exiting the dev server left Postgres, Redis, and the rest of the containers running in the background until torn down manually. Exiting now tears the whole stack down with it.

---

## [0.0.113] - 2026-08-28

### Fixes

- **The bot could no longer open merge requests, post or update comments, or update a merge request's description** — every one of these actions failed outright. They now work correctly again.

---

## [0.0.112] - 2026-08-27

### Fixes

- **Work-item-resolve could get stuck replying to its own comment in an endless loop** — the check meant to recognize the bot's own merge request reply and avoid treating it as new feedback never actually matched, because the two sides of the comparison used different formats for the same ID. Every reply the bot posted looked like unaddressed feedback, so it kept re-triggering a fresh run that replied again, indefinitely, duplicating the same comment. Fixed the comparison so the bot now correctly recognizes its own replies.
- **A work-item-resolve run could repeatedly re-check for review feedback within the same run instead of just once** — the check added in the last release didn't correctly remember it had already run, so it kept firing on every remaining turn instead of only right before concluding. Fixed to fire at most once per run.

---

## [0.0.111] - 2026-08-27

### Features

- **A work-item-resolve run could finish without noticing new review feedback** — once a merge request already existed, the agent only checked for new comments if it remembered to; a comment left while it was still working could go completely unaddressed. It now checks for unaddressed feedback one more time right before concluding, whether or not it checked earlier in the run.

### Fixes

- **The person who assigned an issue was added to the resulting merge request as an assignee instead of a reviewer** — so GitLab's own review-request notifications and reviewer-specific views never picked them up. They're now set as reviewer instead.

---

## [0.0.110] - 2026-08-27

### Fixes

- **Work-item-resolve sandboxes could fail to start** — a network restriction added alongside the new sandbox runtime required a permission the sandbox's Docker proxy didn't grant, so sandbox creation could fail outright. The restriction wasn't enforceable in this deployment anyway, so it's been removed rather than patched around.

---

## [0.0.109] - 2026-08-26

### Features

- **A run's timeline didn't show what the agent was actually told to do** — only its tool calls and messages were visible, so there was no way to confirm the agent received full context (project memories, repository instructions, the actual task) before it started working, on either an MR-review or work-item-resolve run. Both workflows now show this instruction context as its own entry in the timeline, right where the agent begins work.

### Fixes

- **Work-item-resolve could never complete a run** — the sandboxed environment it used to execute code couldn't get through a full dependency install without failing, blocking every run at that step. Sandboxes now run on different underlying technology that doesn't hit this limitation.
- **Sandboxes and a couple of other internal services could fail to reach things running on the host itself, like the LLM server** — an incorrect network address for this deployment meant they were reaching for the wrong target. Fixed to use the address that's actually correct here.
- **A sandbox could run out of memory partway through a run and fail** — the default memory limit was too low for a typical dependency install. Raised to give sandboxes enough headroom.

---

## [0.0.108] - 2026-08-25

### Fixes

- **Tool call arguments had no scrollbar, unlike their output** — a tool like the sandbox's file-write showed its full input inline with nothing capping its height, so a large file pushed the whole run view out of shape. Arguments now scroll the same way output already did.
- **Work-item-resolve's sandbox could see its checked-out repo but not write to it** — file edits and shell commands inside the sandbox failed with permission errors even though the workspace looked correct, because newly checked-out files never picked up write access for the sandbox's own service account. Sandboxes can now write to their own workspace as expected.

---

## [0.0.107] - 2026-08-25

### Fixes

- **Work-item-resolve's sandbox could get an empty workspace instead of the real repo** — the directory mounted into the sandbox sometimes didn't line up with where the checked-out code actually lived, leaving the agent nothing real to work from. It could still complete the run, but by inventing changes from the issue description alone rather than editing the actual code. Sandboxes now always see the real checked-out repository.

---

## [0.0.106] - 2026-08-25

### Features

- **Branch creation and push now show up as their own steps in a work-item-resolve run** — previously these happened silently inside other steps, so the run's timeline jumped straight from issue classification to opening the merge request. Both are now visible on their own as they happen, each showing the branch name involved.

### Fixes

- **Aborting a work-item-resolve run didn't stop an in-progress sandbox command or GitLab lookup** — clicking abort while a shell command was running in the sandbox, or while the run was reading issue/GitLab details, left that step running to completion anyway. Aborting now stops both right away.
- **Sandbox creation in production could time out even after the sandbox was created** — sandboxes now connect using the method that actually works for how the app is deployed, instead of one method assumed to work everywhere.
- **Sandbox creation in production could fail with a path-permission error** — the app's data directory setting must now be an absolute path; this was already the expectation but wasn't enforced, so an incorrectly-set value could resolve to the wrong location at runtime.

---

## [0.0.105] - 2026-08-24

### Fixes

-  **Work-item-resolve runs could time out waiting for their sandbox to become ready** — even after a sandbox was created, the step could still fail before the agent started work. Runs now connect to the sandbox the right way, so this step completes reliably.

---

## [0.0.104] - 2026-08-24

### Fixes

- **Work-item-resolve runs could fail at the sandbox-creation step** — assigning the bot to an issue could error out before the agent ever started work. Sandbox creation is now reliable, so runs proceed normally.

---

## [0.0.103] - 2026-08-24

### Fixes

- **Assigning the bot to a GitLab Task did nothing** — only classic Issues triggered a run. Tasks assigned to the bot now start work-item-resolve just like Issues do.

---

## [0.0.102] - 2026-08-24

### Features

- **The bot can now resolve GitLab issues on its own** — assign the bot to an issue and it works it autonomously in a sandboxed environment, opening a merge request, posting status updates on the issue, and responding to review comments on its own MR. These runs show up in the dashboard, threads list, and analytics alongside merge-request reviews.

### Breaking Changes

- **The config file's `instructions` key is renamed to `mr_review_instructions`** — repos with an existing config file using the old `instructions:` key must rename it, or those custom review instructions will silently stop being read. A new `work_item_resolve_instructions` key configures instructions for the work-item-resolve workflow above.

---

## [0.0.101] - 2026-08-23

### Features

- **GitLab sign-in is now restricted to a configured allowlist of email domains** — accounts with a different email domain are blocked from signing in.

---

## [0.0.100] - 2026-08-21

### Fixes

- **Analytics wait-time chart was missing queue wait** — the concurrency limits added in 0.0.98 track both review-queue wait and self-hosted-backend wait, but the trend chart only ever plotted backend wait. It now shows both, with a legend to tell them apart.

---

## [0.0.99] - 2026-08-21

### Fixes

- **Rotating the GitLab token didn't fix already-cloned repos** — fetches reused the token baked in at first clone instead of the current one, so a review would keep failing GitLab auth until that repo's clone was deleted by hand. Fetches now always use the current token.
- **A failed git command could log the GitLab token in plaintext** — the error stack trace wasn't covered by log redaction. It's scrubbed now.

---

## [0.0.98] - 2026-08-19

### Features

- **Local model calls are now capped per backend, and any wait is visible** — concurrent requests to self-hosted models (Ollama, sglang) are limited so a burst of reviews can't overload the model server. The run timeline now shows queue and backend wait time inline instead of an unexplained gap.

---

## [0.0.97] - 2026-08-20

### Fixes

- **Self-hosted memory server upgraded and made more reliable to deploy** — chat's project-memory search runs on a self-hosted server, now bumped to version 0.0.8; deploys now recreate it whenever its image changes instead of leaving a stale one running, a broken install fetch now fails the build loudly instead of silently, and its embedding settings no longer get overridden away from the local store they're paired with.
- **Merge requests for more repos now get automatic review** — several additional repos were being skipped; they're now included in automatic MR review.

---

## [0.0.96] - 2026-08-19

### Fixes

- **Project history now reflects a recent repo reorganization** — threads and stored project memories tied to repos that were renamed or moved to a different group now carry their current path, so project grouping and lookups for those repos work again.
- **Fixed the "File an issue" link in the bot's MR comments** — it pointed at the project's old repo path.
- **Automated review now covers additional repos** — these repos previously fell outside the reviewed-project list and were silently skipped.
- **Analytics overview now defaults to a 30-day window** — it previously queried unbounded history by default while the trend chart already defaulted to 30 days, so the two disagreed.

---

## [0.0.95] - 2026-08-17

### Features

- **New local model: Qwen 3.8 (27B, FP8)** — available alongside the existing sglang models. Qwen 3.6 (35B, AWQ) remains the default.

---

## [0.0.94] - 2026-08-12

### Fixes

- **Archiving a thread no longer inflates its run duration** — archiving used to bump the thread's last-updated timestamp, and duration was computed from that same timestamp, so a thread archived weeks after its last run would suddenly show a multi-day duration and jump to the top of the recently-updated list. Run duration is now tracked from the run's own completion time, which archiving can no longer touch, and already-archived threads have had their timestamps corrected.

---

## [0.0.93] - 2026-08-12

### Fixes

- **The chat composer no longer invites you to send into an archived chat** — after 30 days of inactivity a chat is archived and read-only; the message box, model picker, tool/attach menu, and send and retry buttons now gray out instead of only failing after you hit send.

---

## [0.0.92] - 2026-08-11

### Features

- **Comment acceptance rate now gets a final check when an MR merges or closes** — instead of relying on a later review happening to re-check, the bot checks once more right as the MR concludes, so single-review MRs can get a real reading too.

### Fixes

- **Comment acceptance rate counted a freshly-posted comment as "not accepted"** — a comment just published by this same run is guaranteed to show as unresolved (nobody's had a chance to look at it yet), which manufactured a false 0% reading for any MR reviewed only once. Only comments older than the current run are counted now.

---

## [0.0.91] - 2026-08-11

### Features

- **Analytics now shows a comment acceptance rate for reviews** — tracks how many of the bot's own review comments later got marked resolved, alongside the raw resolved/observed count. This is only known for comments a follow-up review happened to re-check, so it understates the true rate for MRs reviewed just once — a tooltip on the stat explains this.

---

## [0.0.90] - 2026-08-11

### Features

- **The context badge can now show what's actually taking up space** — expand it to see a breakdown by category (system prompt, repository instructions, project memories, tool schemas, skill content, conversation messages, and free space) instead of just one aggregate percentage.

---

## [0.0.89] - 2026-08-11

### Features

- **A run stuck repeating itself now gets caught within minutes instead of running the full timeout** — if the model goes quiet on tool calls and its output starts repeating the same text over and over, the run is aborted early instead of grinding on for the full time limit. The analytics dashboard tracks these as a "Generation loop" separately from other timeouts.
- **Error kinds now have their own trend chart** — the analytics dashboard shows daily counts for each failure type (timeouts, aborts, generation loops, and more) over time instead of only a lifetime total, making it easy to spot when a new failure mode started.

### Fixes

- **A comment critic or memory curator call that never finished disappeared from analytics instead of counting as an error** — if that internal call hung until the run's own timeout killed it, the run itself still showed up as failed, but its critic/curator stats looked like the call had never run at all. It's now counted as an error there too.

---

## [0.0.88] - 2026-08-10

### Features

- **Chat can now read a web page when you give it a URL** — turn on the new "Fetch web pages" toggle and ask about a link; the assistant renders the page in a real browser and reads its main content (title included), so it can answer questions about docs, articles, or code repositories you point it at.

---

## [0.0.87] - 2026-08-10

### Fixes

- **Triggering another review for an MR already under review made its thread unclickable** — the new review got queued behind the one in progress, but that also blocked you from opening the thread to check on the review that was already running. Thread rows are now always clickable, whatever their status.

---

## [0.0.86] - 2026-08-09

### Features

- **The app now shows a recovery screen instead of a blank page when something crashes** — a "Copy crash report" button makes it easy to report the issue, and "Reload page" gets you back running immediately. The existing session-check failure screen got the same friendlier treatment, with a clearer explanation of what happened.

### Fixes

- **Hovering over one of the new Analytics trend charts could crash the page** — a date wasn't being converted to readable text before being displayed, which could throw an error or otherwise show an overly long raw timestamp.
- **A trend chart's tooltip showed a raw internal name like "successRate" instead of a readable label** — it now shows plain labels like "Success rate."

---

## [0.0.85] - 2026-08-09

### Features

- **Analytics now shows trend charts for duration, run volume, and success rate over time** — see at a glance whether runs are getting faster or slower, busier or quieter, and more or less reliable, instead of only a single current snapshot.
- **Some Analytics stats now explain themselves on hover** — a few numbers that aren't self-evident, like why a duration's 95th percentile can look much higher than its average, or what a "checkpoint" is, now have a short explanation next to them.

### Fixes

- **Analytics only counted runs from after the feature launched, missing everything before it** — historical reviews and chats are now backfilled into the same stats, so totals and trends reflect your full history instead of starting from a blank slate.
- **The Analytics page left an empty gap at the bottom after scrolling** — the scrollable area now always fills the available space instead of guessing a fixed size.
- **A long repository name in the per-repo table forced the whole table to scroll sideways** — long names now truncate instead.

---

## [0.0.84] - 2026-08-08

### Features

- **Chat now shows a "Memories" summary alongside your conversation history, and the bot can retire outdated ones itself** — a new panel on the chat page tracks personal facts saved or updated during the conversation, and the bot can now delete a personal memory outright when you tell it something it remembered is no longer true, instead of only being able to save or revise one.
- **A new Analytics page shows how the bot is actually performing** — success rate, duration, and error breakdowns, LLM/tool usage, and guardrail activity for both reviews and chat, a per-repo breakdown of review volume and failures, and overall usage totals across users, reviews, chats, and memories.
- **The Dashboard now shows how many people are using the app** — active and total user counts, alongside the existing queue status.

### Fixes

- **Inactive chat threads no longer vanish after 30 days — they're closed instead of deleted** — your message history stays visible, but continuing the conversation or resuming a paused approval on a thread that old is no longer possible; start a new chat instead.
- **Dormant merge request review threads no longer accumulate internal state forever** — a review thread untouched for 30 days is now archived automatically (its history stays visible, but retrying it is no longer available); a new push to the same MR still triggers a fresh review as normal.

---

## [0.0.83] - 2026-08-05

### Features

- **A new Chat page lets you talk directly with the GitLab-aware assistant outside a merge request** — pick a model, attach images, and toggle server tools, GitLab tools, and extended reasoning per message, all in a thread that lives alongside your review threads.
- **Non-read-only chat tool calls pause for human-in-the-loop approval** — the run waits for you to approve or reject before continuing.
- **Chat has its own personal memory, separate from project memories** — the assistant can save a durable fact about you (a preference, a decision, a correction) and recall it in later conversations, without you having to repeat yourself or it having to re-search old transcripts. Browse, filter, and delete your own personal memories from the Memories page, alongside the existing project memories, via a new toggle.

### Fixes

- **Repository instructions resolved as "missing" for every review, even with a valid config file** — the webhook now stores the resolved config under the field the rest of the run actually reads.
- **A brief backend hiccup while checking your session could log you out and bounce you to the login page** — a failed session check now shows a retry prompt instead of signing you out, and opening the login page while already signed in sends you home.
- **Settings could show GitLab as disconnected when the connection check itself just failed** — it now says the check failed instead of implying you need to reconnect.
- **A run that failed while you were watching it live didn't show the error message until you reloaded the page** — it's now shown as soon as the run ends.
- **Settings could show a GitLab connection as "check failed" when it had actually just expired or been revoked** — it now shows disconnected with a reconnect prompt, the same as an account that was never connected.
- **Runs in the sidebar list weren't reachable by keyboard** — they're now real buttons you can tab to and select.
- **A thread run's timestamp only showed up after refreshing the page, and could show a negative duration** — both now come from the same record read when the run finishes, so the timestamp appears immediately and duration is always accurate.

---

## [0.0.82] - 2026-08-04

### Features

- **Settings now shows whether your GitLab connection is still working, with a one-click fix** — if GitLab access expires, it's shown clearly with a "Reconnect" button that restores it without signing out of the app.
- **A review that hung indefinitely (a stuck model call, a stuck tool) could block its thread forever** — a run is now aborted automatically after 10 minutes, with a clear note posted to the merge request explaining why.

### Fixes

- **Signing back in after being logged out dropped you at the dashboard instead of where you were** — you're now returned to the page you were on.
- **A failed GitLab sign-in or reconnect attempt showed no feedback at all** — these now show an error message like other failed actions in the app.
- **A review stopped by repeated identical tool calls looked like a generic failure** — it's now treated like any other aborted review, with a clearer merge request note.

---

## [0.0.81] - 2026-08-03

### Fixes

- **Signing in from a trusted non-HTTPS address (like a LAN IP) failed right after granting GitLab access, with a state-mismatch error** — cookie security now follows the configured trusted addresses instead of assuming HTTPS everywhere, so a plain-HTTP address can complete sign-in like any other trusted one.

---

## [0.0.80] - 2026-08-03

### Fixes

- **Signing in while accessing the app from an address other than its main one could leave you signed out afterward** — the app now recognizes sign-ins from any of its configured addresses.

---

## [0.0.79] - 2026-08-03

### Fixes

- **Signing in from a non-default address (like a LAN IP) failed with an invalid callback error** — the set of allowed post-login redirect origins is now configurable instead of being limited to localhost.
- **Login rate limiting couldn't tell users apart behind the reverse proxy, so it throttled everyone as a single shared bucket** — client IPs are now resolved correctly from the proxied request.
- **A failed GitLab sign-in or sign-out showed no feedback at all** — these now show an error message like other failed actions in the app.

---

## [0.0.78] - 2026-08-02

### Fixes

- **Retrying a run kept its confirmation dialog open and spinning for as long as the retried run took to finish streaming** — the dialog now closes as soon as the retry starts, and the run continues streaming in the background like any other run.

---

## [0.0.77] - 2026-08-01

### Features

- **The app had no per-user login, and destructive actions (deleting a thread or memory, retrying or aborting a run) were confirmed with a single shared admin password** — you now sign in with your GitLab account, and only specific GitLab accounts (configured by an admin) can perform these actions, instead of anyone who knows the password.

### Fixes

- **Merge request reviews couldn't load their own step-by-step instructions in production** — they now load correctly.

---

## [0.0.76] - 2026-07-30

### Fixes

- **Switching threads, workflows, projects, or filters could flash the previous page's content for a frame before the new one loaded** — thread detail, workflow detail, the memories page, and the threads list now clear stale content immediately instead of briefly showing it while the new data arrives.
- **A scrollable panel in the run timeline or todo list left empty space below short content instead of shrinking to fit it** — these panels now size themselves to their content instead of reserving a fixed height.
- **The run timeline didn't follow along while a review was streaming, leaving new output to arrive below the visible area** — it now sticks to the bottom while a run streams, and snaps back down whenever you send a message or retry a run, unless you've scrolled up to read earlier output.
- **A review that repeatedly ended a turn without calling a tool, left a trailing question, or skipped reflecting on a candidate memory got the same corrective nudge every time it recurred** — each of these nudges now fires at most once per run instead of repeating throughout it.
- **Retrying a run in quick succession, or from more than one tab, could start two runs on the same thread at once and corrupt its checkpoint history** — a retry is now rejected outright if the thread already has a run in progress.
- **A tool aborted by the duplicate-call guard included "Aborting run" in its own output, as if the tool itself had ended the run** — its output now only reports the repeated call; the abort is recorded separately as the run's actual failure reason.

---

## [0.0.75] - 2026-07-29

### Fixes

- **The safeguard for a review stuck repeating the same read-only lookup only caught strictly back-to-back repeats, missing the same call recurring with other work interleaved in between** — it now catches recurrence across the whole review, aborting once that exact call has repeated too many times in total.
- **The default review model changed from Qwen 3.6 27B to the larger 35B variant** — reviews that don't specify a model now run on 35B by default.

---

## [0.0.74] - 2026-07-29

### Fixes

- **A review that failed after worktree setup retried still showed "0 retries," hiding that it had tried at all** — the retry count now reflects what actually happened, whether the retries eventually succeeded or not.
- **A review stuck repeating the same read-only lookup over and over never stopped itself** — it now aborts once it's issued the exact same call too many times in a row instead of looping indefinitely.
- **The run timeline could show a stale result for a repeated lookup or a draft comment's publish check, hiding what the review actually saw** — both now show the corrected, up-to-date result instead of the original pre-check one.

---

## [0.0.73] - 2026-07-29

### Fixes

- **A review comment anchored to an unchanged line inside a diff hunk could silently disappear, even though the run reported it as posted** — the position sent for these lines didn't carry enough information for GitLab to place it, so GitLab accepted and appeared to publish it without ever creating a visible comment. These positions are now caught and rejected before they're sent, instead of failing invisibly after the fact.
- **Two reviews starting on the same repository at once could collide and fail with a raw git error instead of just waiting their turn** — fetching a repository is now fully serialized per repository, so a concurrent review queues behind it instead of racing it.
- **A transient git hiccup during worktree setup (a dropped connection, a fleeting lock) failed the review outright** — worktree setup now retries a few times before giving up, and a failed clone or worktree creation no longer leaves behind a half-created directory that would trip up the next attempt; the run timeline shows a retry count when this kicks in.

---

## [0.0.72] - 2026-07-28

### Fixes

- **Every review on sglang failed outright before it could do any work** — the request it sent included two leading instructions where sglang's model only accepts one, so it was rejected every single time. The two are now combined into one.
- **Every retry silently got stuck queued and never ran** — its queue entry used an id shape the queue library rejects outright, so the retry was dropped before it ever reached the review worker. Retries now use an id it accepts.

---

## [0.0.71] - 2026-07-28

### Fixes

- **Retrying a run could get stuck queued forever if it failed to join the review queue** — it's now marked failed instead, so it doesn't sit unpicked with nothing to run it.

---

## [0.0.70] - 2026-07-28

### Fixes

- **Reviews routed to sglang failed outright with a connection error** — the backend was trying to reach it through the container's own network instead of the host machine; it now reaches sglang the same way it already reaches Ollama.
- **Retrying a failed run bypassed the review queue and started immediately, ignoring the concurrency limit** — retries now queue like any other review, so they're capped by the same limit as fresh reviews.

---

## [0.0.69] - 2026-07-28

### Features

- **Reviews can now run on sglang, a new self-hosted backend alongside Ollama and OpenRouter** — AWQ-quantized 27B and 35B variants of Qwen 3.6 are selectable through it, with the 27B AWQ variant as the new default.
- **Review concurrency raised from two to four** — more merge requests can now be reviewed at the same time.

---

## [0.0.68] - 2026-07-28

### Fixes

- **Project memories within a category listed oldest-first, so the most current entries were buried at the bottom** — each category now lists most-recently-updated first.

---

## [0.0.67] - 2026-07-27

### Fixes

- **A review could be aborted for repeating a read-only lookup, even when those repeats were spread out across an otherwise healthy, productive run** — repeating a read no longer ends the run; it's still flagged as wasted, but only a repeated *write* (which risks a real duplicate GitLab comment) still aborts.

---

## [0.0.66] - 2026-07-27

### Fixes

- **Qwen 3.6 (27B) reviews tracked context usage inaccurately, letting conversations grow larger than intended before compacting** — the model was missing its tokenizer mapping; it now shares the same tokenizer as the 35B variant, so context tracking for it is accurate.
- **Qwen 3.6 (27B), made the default last release, took meaningfully longer per run than the existing 35B mixture-of-experts model** — Qwen 3.6 (35B) is the default again; the 27B model is still selectable.

---

## [0.0.65] - 2026-07-27

### Features

- **A dense 27B variant of Qwen 3.6 is now selectable as a model, and is the new default** — sitting alongside the existing 35B mixture-of-experts version, so review quality and run time can be compared between the two.

### Fixes

- **A tool call caught in a repeat loop always said it was on its "4th" attempt, no matter how many times it had actually repeated** — the warning now reports the real number of repeats, so it's clear how stuck the model actually got.

---

## [0.0.64] - 2026-07-27

### Fixes

- **A run that aborted after a tool call kept failing showed no trace of that call in its timeline** — only the abort message was visible, not the call that actually triggered it; the failing call is now recorded like any other, so it's clear what caused the abort.
- **A successful repeat of data already fetched earlier in a review didn't count as real progress for a separate, still-failing call** — that failing call's streak now resets on any real progress, matching how retries with other work in between are supposed to be treated.

---

## [0.0.63] - 2026-07-25

### Fixes

- **A run that failed before its first checkpoint had no way to be retried** — the retry action required a checkpoint to resume from, leaving these runs stuck; a failed run with no checkpoint now shows a "Retry" button that reruns the original input from the beginning.

---

## [0.0.62] - 2026-07-25

### Fixes

- **A draft comment's diff position could be validated against a branch that had since moved, silently checking a different version of the code than what GitLab would check on publish** — positions are now validated against the exact base and head commit GitLab reported for that comment, not the branch names, so validation can't drift mid-review.
- **A draft comment that GitLab published but couldn't anchor to a diff line was mistaken for one that never posted, causing it to be retried and duplicated** — these unanchored posts are now recognized and left alone instead of retried.
- **A single oversized tool result could blow past the model's context limit on its own** — every tool result is now capped at 40,000 characters, with an oversized result truncated and flagged rather than passed through whole.
- **A review cut short by the model's own length limit could still get nudged to keep going** — a turn that ends because the model ran out of budget, not because it actually finished, is no longer treated as a genuine conclusion needing a corrective nudge.
- **Tool call inputs and outputs in the run timeline showed literal `\n` instead of line breaks** — multi-line tool data now renders with real newlines, matching how it reads everywhere else.

---

## [0.0.61] - 2026-07-23

### Fixes

- **A review's code search could fail outright on a pattern containing parentheses** — the search treated parentheses as regex grouping by default, so an escaped snippet copied straight from the diff (e.g. a function call) could be rejected instead of matched; the review can now request that exact text as a literal search instead of a regex.

---

## [0.0.60] - 2026-07-23

### Features

- **A re-review could report nothing further needed without checking anything new** — a run that finishes without calling a single tool is now nudged to verify the merge request's current state (new commits, diff, open discussions) before concluding, instead of just repeating a previous run's summary.

### Fixes

- **A long merge-request review could keep growing well past the point meant to trigger a context reset** — the safety margin around that trigger was too tight for tool-heavy reviews, letting real usage climb past the intended threshold before ever condensing; the margin is now wider so it fires earlier and more reliably.

---

## [0.0.59] - 2026-07-22

### Fixes

- **A pre-existing comment from a human reviewer could be mistaken for the review agent's own draft landing** — only comments created after the run started tracking drafts now count as occupied positions, so older comments at the same line are no longer mismatched.
- **Some review comments could be created with a broken diff position that GitLab accepted but could never display** — a position where the base and head commit are identical is now rejected up front, so every comment renders its diff snippet correctly.

---

## [0.0.58] - 2026-07-22

### Fixes

- **The project filter on the Memories page didn't show which project was currently selected** — the selected option now shows a checkmark.
- **A review agent could be aborted mid-run for repeatedly failing a tool call, even after making real progress in between attempts** — the failure count now only keeps climbing when the exact same call fails back-to-back; any successful step or switch to a different call clears the slate, so genuine progress no longer counts against the retry limit.
- **The "comments opened" count on a thread could include comments that were later deleted** — deleted comments are now subtracted, so the count reflects what's actually still open.

---

## [0.0.57] - 2026-07-22

### Fixes

- **Retrying a run on a long-running review thread could freeze the entire server for everyone, not just that run** — the retry now reuses already-computed context sizing instead of recalculating it from scratch on every step, so it no longer blocks other reviews while it catches up.
- **A cancelled git operation (for example, when a newer push superseded an in-progress review) was logged as a failure** — cancellations are no longer reported as errors, since aborting them was expected rather than a fault.

---

## [0.0.56] - 2026-07-21

### Features

- **Refreshing a thread's page used to jump you back to the latest run, losing your place** — the run you have open now stays open across a refresh, and the link can be shared or bookmarked to reopen that exact run.

### Fixes

- **A run that failed after repeating the same broken tool call reported that it had been "nudged" to stop, even when it had actually just failed the same way every time** — the failure reason now accurately describes which of the two happened.

---

## [0.0.55] - 2026-07-21

### Fixes

- **A rejected review comment got the same unhelpful "you already tried this" message on every retry instead of the actual rejection reason** — repeated attempts now surface the real error each time, giving the review agent an actual chance to fix the comment instead of repeating the same broken attempt until the run gives up.

---

## [0.0.54] - 2026-07-21

### Fixes

- **A blocked review-comment attempt could vanish from a run's activity log without a trace, sometimes aborting the whole run with no visible cause** — rejected or repeated tool calls (e.g. an inline comment with an invalid diff position) now show up in the run's timeline along with the reason they were blocked.

---

## [0.0.53] - 2026-07-21

### Fixes

- **Reviews could post a generic, unhelpful summary comment on merge requests alongside real findings** — that top-level summary text is no longer published; only specific, actionable line comments get posted.

---

## [0.0.52] - 2026-07-20

### Fixes

- **Aborting a review run left its merge request note stuck on "Review in Progress"** — cancelling a run now updates the note to show it was aborted instead of leaving a stale in-progress status behind.
- **Reviewing a large merge request could overload the review agent's context and force a lossy mid-review summary** — diff and search tool results are now capped in size, with any omitted file's diff still fetchable individually.

---

## [0.0.51] - 2026-07-20

### Features

- **MR review now checks out the branch locally instead of relying solely on GitLab's API for diffs** — reviews run against a real git worktree of the repo, making diff and file lookups faster and less dependent on GitLab API availability.
- **The review agent can now read and search whole files, not just diff hunks** — it can list directories, read any file in the checked-out branch (paginated for long files), and grep across the repo to trace a change's callers, related config, and tests before commenting.
- **The todo list on a run's detail page is now scrollable and shows a completion checkmark** — long todo lists no longer push other panel content out of view.

### Fixes

- **Logs could leak auth tokens, cookies, and repository credentials** — request headers and git command output are now redacted before being written to logs.
- **Some review findings could post as general top-level comments instead of anchored to the flagged line** — a comment without a valid diff position now requires one before it's submitted, so review feedback always lands as an inline, resolvable comment rather than an untracked top-level one.
- **Canceling a review run could leave git diff lookups running in the background** — aborting a run now properly cancels the underlying git processes instead of letting them keep running after the run stops.

---

## [0.0.50] - 2026-07-17

### Fixes

- **The project-memory curator could silently drop some of a run's candidates, saving fewer entries than it actually considered** — the prompt allowed it to return an empty or short list when it judged nothing durable, so a candidate it should have skipped explicitly just vanished with no record. It's now required to account for every candidate (marking one a skip rather than leaving it out), retries if it still returns too few, and keeps the entries it did produce instead of discarding them on a mismatch. A per-run "missed" count is recorded so a shortfall is visible instead of invisible.

---

## [0.0.49] - 2026-07-17

### Fixes

- **A review run could get stuck repeating the same failing action forever instead of ending** — a call that errored every time (such as approving an already-approved merge request) wasn't counted as a repeat, so the run looped until it hit its ceiling. Identical failing calls are now capped and the run stops cleanly.

---

## [0.0.48] - 2026-07-16

### Features

- **Memories had no way to remove a stored entry** — a delete button now appears next to each entry on the Memories page, confirmed with your admin password just like deleting a thread.

### Fixes

- **Running the legacy memory-event migration bumped affected threads to the top of the list and inflated their run durations** — the backfill was updating each run's timestamp as if new activity had happened, even though it was only reshaping old data. It now runs without touching those timestamps, and a follow-up migration restores the correct values for runs and threads it already affected.

---

## [0.0.47] - 2026-07-16

### Fixes

- **The project memory list could pick up several near-identical entries for the same fact** — the curator only checked for duplicates among existing memories filed under the category it guessed for its own new entry, so a fact already stored under a different category went unnoticed. It now compares against every existing memory before deciding to add one.
- **Runs from before the current memory-event format showed inconsistent or missing counts in the Memories row and Debug timeline** — a one-time migration backfills those older runs into the current shape so past and current runs display the same way.

---

## [0.0.46] - 2026-07-16

### Fixes

- **A transient network hiccup while counting tokens for context summarization could crash every run afterward until the backend restarted** — the failed fetch got cached and replayed on every later call instead of retrying. The tokenizer is now bundled with the app instead of fetched over the network, so this no longer depends on external availability at all.

---

## [0.0.45] - 2026-07-16

### Features

- **A run's project-memory activity had no visible summary until you dug into the Debug timeline** — thread detail's sidebar now shows a "Memories" row next to Review threads, counting what's pending mid-run and what the curator decided (new/updated/retired/skipped) once it finishes.
- **The Runs list and metrics sat in a fixed block above the Summary/Debug tabs on tablet and mobile, permanently eating vertical space with no way to hide it** — they now live in a Runs drawer opened from the header, matching what the desktop sidebar shows without crowding the page on small screens.

### Fixes

- **The system prompt only implied `create_memory_candidate` could be called more than once per run** — it now says explicitly to flag each distinct fact as it comes up, not just the first.
- **Workflow detail's execution graph had no independent scroll region and could run off-screen on tall graphs** — it now scrolls in its own body under a fixed header, matching thread detail's layout.
- **A todo long enough to wrap onto a second line centered its status icon against the whole block instead of its first line** — todo rows now align to the top.

---

## [0.0.44] - 2026-07-15

### Fixes

- **A single malformed response from the project-memory curator could silently drop an entire run's worth of flagged candidates** — the curator now retries a failed curation attempt before giving up, and the run/category timeline shows how many retries it took.
- **The same fact could be saved as a project memory twice under two different categories** (e.g. once as "knowledge", once as "decision") — the curator now reviews every category a run touched in one pass instead of one category at a time, so it can catch the overlap and pick the best-fitting category itself.
- **Curated memories sometimes read like a feature summary instead of something a future review could act on** — the curator now only saves a fact if it can be phrased as a check or rule a reviewer could apply next time.

---

## [0.0.43] - 2026-07-15

### Fixes

- **A single malformed response from the comment critic could block an entire batch of review comments from ever being posted** — the critic now retries a failed screening attempt before giving up, and if it still can't produce a verdict, publishes the batch unscreened instead of silently withholding every comment in it, good and bad alike.
- **Comment critic could drop a comment reporting genuine progress on a previously-flagged issue, or a legitimate "this doesn't belong in this MR" scope note, as if it were spam** — it now keeps comments that describe something new about the latest fix attempt, and treats out-of-scope changes mixed into an MR as a concrete, actionable finding rather than a style opinion.

---

## [0.0.42] - 2026-07-15

### Features

- **Memories page gave no way to tell which projects actually had memories without checking each one** — the project picker listed every project that had a thread, regardless of whether it had accumulated any memories, so finding one with real content meant selecting projects one at a time and waiting for "no memories yet" to load. The picker now shows a count badge next to each project and sorts the ones with memories to the top.

---

## [0.0.41] - 2026-07-15

### Fixes

- **Project memory never actually got created** — flagging a durable fact relied entirely on the review agent electing to call `create_memory_candidate` mid-task, with nothing forcing it to consider it. The agent is now nudged to reconsider once, right before a run ends with nothing flagged.
- **A re-review could skim past a genuinely open thread buried in a long, interleaved list of discussions** — the discussions lookup has no resolved-status filter and returns everything at once. The review skill now explicitly classifies every discussion into an open-threads list before triaging, instead of eyeballing the raw response.
- **A mismatched `old_line`/`new_line` pairing could still slip through and get silently dropped by GitLab at publish time** — position validity is now checked automatically before a draft comment reaches GitLab, rejecting a bad pairing with the specific reason. Every publish call is also now verified live against the discussions endpoint, so the agent knows exactly which drafts landed regardless of what the call itself reports.

---

## [0.0.40] - 2026-07-15

### Fixes

- **A repeated read-only check after an ambiguous publish could get blocked as a "duplicate call" instead of actually running** — read-only checks like these now always run for real; only actions that change something (posting or deleting a comment, etc.) still get blocked on an exact repeat.
- **The corrective nudge only warned about one repeated tool call per turn, even when several were looping at once** — it now calls out every call that hit the repeat limit in that turn, not just the first one.
- **`old_line`/`new_line` pairing across an unequal-count diff replace could silently drop a draft comment at publish time** — the review skill now spells out the failure mode and the fix (`new_line`-only for pure additions, both only for a truly unchanged line).

---

## [0.0.39] - 2026-07-15

### Fixes

- **A review could report draft comments as "posted" when some hadn't actually landed** — a bug in how the bot tracked its own draft-comment checks meant a follow-up look at pending drafts after publishing could return outdated results. Fixed, and comment deletions are now tracked the same way.

---

## [0.0.38] - 2026-07-15

### Fixes

- **Agent could skip a required step after a failed action, or assume it succeeded without checking** — it now always retries recoverable failures, never skips a required step just because a call failed, and verifies before moving on.
- **Code review skill's guardrails against duplicate threads, non-actionable comments, and inconsistent approvals were easy to miss** — they're now collected into one clear Review Principles section at the top of the skill.
- **A legitimate re-check after posting or resolving something could get flagged as a wasted repeat call** — checks like these now correctly reflect the latest state after a related action, so a genuine follow-up check isn't mistaken for a duplicate.

---

## [0.0.37] - 2026-07-15

### Fixes

- **Run timeline's collapse toggle didn't work on withdrawn draft comments** — when a draft was withdrawn before publishing, clicking to expand or collapse that entry silently did nothing. It now works like any other entry.

---

## [0.0.36] - 2026-07-14

### Fixes

- **Code review skill never confirmed that published comments actually landed** — the publish call's result isn't reliable in either direction. The skill now re-checks pending drafts after publishing, retries any still-pending draft, and reports honestly if one still can't be confirmed.

---

## [0.0.35] - 2026-07-14

### Features

- **Reviews now build durable, project-specific memory over time** — the agent can flag durable facts as it works (conventions, recurring false positives, team preferences, architectural decisions) via `create_memory_candidate`; after each review, these are compared against what's already stored and used to add, update, or retire notes, and future reviews of the same project are seeded with the accumulated notes.

### Fixes

- **Code review skill's file-exclusion example used glob syntax the GitLab tooling doesn't accept** — the changed-files lookup matches exclusion patterns as regex, not glob. The example now shows working regex (`\.lock$`, `\.min\.js$`, `^dist/`).

---

## [0.0.34] - 2026-07-14

### Fixes

- **A long review could end up looking at the wrong merge request** — once a review ran long enough to compact its context, it could lose track of which project and MR it was reviewing and fail its GitLab lookups. The original request now stays in scope for the rest of the run, however long it goes.
- **Thread page always showed 0 comments posted, even when a review posted real feedback** — the opened/resolved comment counter is now wired up correctly.

---

## [0.0.33] - 2026-07-14

### Fixes

- **Reviews could post duplicate or lower-quality comments** — a configuration mismatch could lose track of already-drafted comments, letting retries duplicate them and skip the quality check. Reviews now correctly track their own drafts.

---

## [0.0.32] - 2026-07-13

### Fixes

- **Reviews could end on a "would you like me to...?" question, halting an unattended run** — the bot now always ends with a factual summary instead of a question, with a safety check that catches any leftover question before the run finishes.
- **A repeated duplicate tool call could abort an otherwise-recoverable run** — before the hard abort at 3 nudges, the model is now asked directly to stop and use the result it already has.

---

## [0.0.31] - 2026-07-13

### Fixes

- **Thread page crashed when a tool's output wasn't JSON** — some tools (e.g. GitLab's resolve-thread call) return plain text instead, which used to crash the page. Non-JSON output now just displays as raw text.

---

## [0.0.30] - 2026-07-13

### Fixes

- **Disable reasoning** — switched off reasoning for faster reviews.

---

## [0.0.29] - 2026-07-11

### Fixes

- **GitLab integration was less reliable than it should be** — switched to a more reliable GitLab connector.
- **Markdown-rendered code blocks showed a doubled background** — nested code blocks now render with no background from the wrapper.

---

## [0.0.28] - 2026-07-10

### Fixes

- **An internal screening call could leak into the run's visible conversation** — only one of these behind-the-scenes checks was hidden from view; the comment critic's wasn't. All of them are now hidden, and any new ones are caught automatically instead of slipping through.
- **Comment critic kept re-flagging the same unresolved issue every re-review round** — bare "still not addressed" reposts are now dropped unless the reply describes something new.
- **Code review skill could miss re-review state or reintroduce duplicate threads** — the skill now always checks existing discussion state first regardless of round, and reads both sides of a "rewritten" file's diff before treating a concern as reintroduced.

---

## [0.0.27] - 2026-07-09

### Fixes

- **Review skill could duplicate comments and silently miss threads past the first 20** — it only checked pending drafts (not published discussions) before drafting, and treated the discussions endpoint's paginated response as complete. It now checks existing discussions first and pages through until exhausted.

---

## [0.0.26] - 2026-07-09

### Features

- **Comment critic screening now shows its prompt and raw verdicts** — the run timeline event now includes the exact prompt sent to the critic and its raw per-comment verdicts, not just the withheld/failed count.
- **Context summarization now shows its prompt** — the run timeline event now includes the exact summarization prompt alongside the outcome.

---

## [0.0.25] - 2026-07-09

### Fixes

- **Withholding a draft comment could crash the run** — the withholding note was tacked onto the raw tool result, breaking the format the agent expected. It's now added without breaking the result.

---

## [0.0.24] - 2026-07-09

### Fixes

- **Retrying a tool call after it failed could get wrongly flagged as a wasted repeat** — a failed attempt was being treated as if it had succeeded, so a genuine retry got nudged away instead of running. Retries after a failure now go through normally.
- **Draft comment critic could block publishing on every review with a local model** — at least one local model didn't reply in the expected format; the critic now asks in a way it follows reliably.

---

## [0.0.23] - 2026-07-09

### Fixes

- **Draft comment screening never actually ran** — a naming mismatch in how the critic checked which tool had been called meant it silently never screened a single comment. Fixed.

---

## [0.0.22] - 2026-07-09

### Features

- **Draft review comments are now screened before publishing** — a critic pass judges each draft and silently withholds low-value comments (hedged non-issues, diff restatements, unsupported speculation, style opinions dressed up as bugs). The run timeline shows how many were screened and withheld.
- **Repository instruction loading is now visible in the run timeline** — the debug view now shows the resolved config, instruction status, and any error directly, instead of only via the GitLab MR note or server logs.

### Fixes

- **Agent could stall a run by asking for confirmation it would never receive** — the system prompt now states explicitly that there's no one to respond mid-task, and the agent should use its best judgment through to completion.

---

## [0.0.21] - 2026-07-09

### Fixes

- **Duplicate MR threads could survive re-review, and carried-over threads got a no-op "still present" reply every round** — the skill now resolves duplicates as soon as they're spotted (with a final check before approving), and carried-over issues stay silently open unless there's a genuinely new development.

---

## [0.0.20] - 2026-07-09

### Fixes

- **Context summarization no longer drops the system prompt** — long runs could lose their original instructions once the conversation was compacted. They're now preserved through every round of summarization.
- **Preserved todo/skill-load calls no longer pile up indefinitely** — a very long run could keep accumulating old preserved calls without limit. Only the most recent call per tool is kept now.
- **Context summarization could immediately re-trigger on large diffs** — the amount kept after summarizing was a fixed size, so one large diff could blow right past it and set off another summarization right away. It now scales with what's being kept.
- **Context summarization now retries on failure instead of failing silently** — it now retries up to 3 times, with the run timeline showing retry progress or a final error instead of looking stuck.
- **Context summaries now follow a stricter extraction format** — summaries now extract only what's needed to continue (the MR under review, what's checked, what remains) instead of inconsistent raw dumps.

---

## [0.0.19] - 2026-07-09

### Fixes

- **Repeated todo-write calls now flagged like any other repeat** — this call was previously exempt from the repeat-call check that catches every other tool. Fixed.
- **Stuck retry loop on a repeated tool call now aborts the run** — after three ignored nudges the step was marked failed but the run kept looping. It now aborts after the third ignored nudge, with a clearer nudge message.
- **Review agent could recreate stale drafts and miss open threads on re-review** — the agent had no way to see its own prior drafts (tool wasn't enabled). The skill now enables that check, treats repeated threads as duplicates, and verifies every thread was resolved before approving.
- **Retried model calls no longer duplicated in the run timeline** — a call retried multiple times showed a separate entry per attempt. Only the most recent attempt is now shown.

---

## [0.0.18] - 2026-07-08

### Fixes

- **Todo results no longer dropped by context summarization** — todo state could be discarded on compaction, losing progress mid-run. These calls are now preserved and reinserted after the summary, alongside skill-load calls.

---

## [0.0.17] - 2026-07-07

### Fixes

- **Reply threading no longer creates duplicate discussions** — replying without a line position could make GitLab spawn a new discussion instead of threading. Replies now include the position when the flagged line still exists, and don't repeat an "unaddressed" reply once already said.
- **Skill-load results no longer dropped by context summarization** — loaded skill instructions could be discarded on compaction. These calls are now preserved and reinserted after the summary.
- **Tooltips now appear on mobile** — tooltips only triggered on hover; they now also trigger on focus and touch.

---

## [0.0.16] - 2026-07-07

### Fixes

- **Instruction status no longer stuck on "Loading"** — completed reviews of repos without a config file (or with no instruction docs) now correctly show "No repository instructions configured." instead of remaining on "Loading repository instructions…". Always-on instruction docs were affected by the same issue.

---

## [0.0.15] - 2026-07-07

### Fixes

- **Agent recursion limit raised** — the agent's recursion limit has been increased from 100 to 200, preventing reviews from failing on large merge requests that require many tool-calling steps to complete.
- **Run summary text no longer clips** — long text in the run summary alert now wraps correctly instead of being cut off at the edge.

---

## [0.0.14] - 2026-07-06

### Features

- **Per-repo review configuration via a config file** — a repo can drop a config file at its root to add instruction docs (optionally scoped by match globs) and skip review entirely for certain branch globs. Optional — repos without one review exactly as before.
- **Automatic context summarization** — when a run's conversation grows too large, older messages are compacted into a summary instead of silently dropped. The run timeline shows when this happens and the summary can be expanded to read.
- **Repeated tool calls now get flagged** — calling the same tool with the same arguments again points back to the earlier result instead of running it again; repeating it enough times stops the run to prevent a runaway loop.

### Fixes

- **Reviews could stall on a slow GitLab** — requests now time out promptly instead of hanging for minutes and blocking the queue.
- **Context unit shown for negative values** — the context usage display now includes the unit (e.g. "k") even when the value is negative, matching how positive values are formatted.
- **Tooltip replaces native HTML title on run timeline items** — run timeline entries now use a proper styled tooltip instead of the browser's default `title` attribute popup.

---

## [0.0.13] - 2026-07-06

### Features

- **Context usage tracking** — each run now shows context window usage in the Runs list and as a color-coded badge, with the debug timeline showing per-step additions. Usage carries over across runs and forks in the same thread.

---

## [0.0.12] - 2026-07-05

### Features

- **Review thread metrics in thread detail page** — each thread now shows how many review comment threads the bot opened, resolved, and left open across all its runs. The MR note posted on GitLab now also links back to the thread in the app.
- **Open thread in a new tab** — middle-clicking (or ctrl/cmd-clicking) a thread in the threads list now opens it in a new tab instead of always navigating in place.

---

## [0.0.11] - 2026-07-03

### Fixes

- **Reviews faster after the first message** — reviews now respond more quickly after your first message.
- **Unknown model crashes retry** — retrying a run whose model had been removed from the configuration would crash. It now logs a clear error naming the unknown model.
- **Failed model attempts leaked partial text into history** — when a model call failed and was retried, the partial text from the failed attempt was saved into the conversation. Only the successful attempt's message is kept now.

---

## [0.0.10] - 2026-07-03

### Fixes

- **Re-review pushes waited out the full debounce even with nothing running** — a push to an MR always waited the full 5-minute debounce before its review started, even if the prior review had already finished. It now starts immediately when nothing is actually in flight.
- **Superseded runs had no status color** — the run list had no color mapped for the "superseded" status, so debounced-away runs showed with a blank indicator dot instead of a muted one.

---

## [0.0.9] - 2026-07-03

### Features

- **Run history on the threads list** — each thread now shows its total run count and how many recently failed, right in the list, so a thread that's been struggling is visible without opening it.
- **Reviews recover from malformed model output** — some models occasionally emit malformed tool-call syntax mid-review. The bot now retries the same step automatically instead of failing the whole run.

### Fixes

- **Debounced pushes could delete a run that had already finished** — a push arriving while an older one was being superseded could, in rare timing, delete a run row for a review that had actually already completed. Superseded runs are now marked as such instead of deleted, so a finished review's record is never lost.
- **Retrying a review reloaded the code-review skill unnecessarily** — a retried run now only reloads the skill if it wasn't already loaded earlier in the conversation.
- **Run history didn't scroll on mobile** — the runs list on a thread's detail page could overflow off-screen without a scrollbar on small viewports. It now scrolls correctly.
- **No explanation for why runs share context** — added a tooltip on the runs list explaining that each run continues with context from previous runs in the same thread.
- **Todo panel showed the wrong run's todos** — selecting an earlier run in a thread still showed the most recent run's todo list instead of the selected run's. It now shows the correct one.
- **Tool error hover state looked inconsistent** — hovering an errored step in the run timeline could show the wrong color. Fixed.
- **Retry button shrank on mobile** — the "retry from here" button in the run timeline could get squeezed and clipped on narrow screens.
- **Queue card on the dashboard had excessive empty space** — the queue status card stretched to the full page width even though its content (stat counts and job list) is narrow. It's now capped to a sensible width.

---

## [0.0.8] - 2026-07-02

### Features

- **Revamped UI** — the single-page chat view has been replaced with a full multi-page app: a persistent navigation shell (collapsible sidebar on desktop, drawer on mobile) linking Dashboard, Threads, Workflows, and Settings. The whole UI is rebuilt on Mantine with a new dark theme, logo, and favicon.
- **Threads list** — browse all threads in a filterable, paginated table (card list on mobile), with multi-select filters by status and project, live duration counters, and silent live updates over the websocket connection as runs progress.
- **Redesigned thread detail view** — each thread now has a dedicated Runs sidebar plus **Summary** and **Debug** tabs. Summary shows the agent's final output and a live "current step" indicator while a review is running; Debug shows the full tool/node event timeline with timings and "Retry from here" on any checkpoint. A collapsible panel shows the agent's live todo list.
- **Workflows area** — a new Workflows section lists available workflows (currently the MR review workflow) with live status and run counts, and a detail page renders the workflow's execution graph as a diagram.
- **Guided product tour** — first-time visitors get a short walkthrough of the app; it can be replayed anytime from a help button.
- **Password confirmation modal** — critical actions (aborting a run, deleting a thread) now confirm via a proper modal instead of the browser's native password prompt.
- **Reviews trigger when a draft MR is marked ready** — marking an MR as "ready for review" (with no new commits) now correctly kicks off an initial review; previously only new commits or opening/reopening an MR triggered one.
- **Ollama API key support** — Ollama requests can now be authenticated with an API key, for use with hosted or protected Ollama endpoints rather than only local unauthenticated ones.
- **Additional repo group support** — webhook events from another internal repo group are now reviewed alongside other supported repos.

### Fixes

- **Run durations could be wrong** — run start times are now always recorded at the exact moment a review starts, so durations can no longer come out negative or inconsistent.
- **Thread "last updated" time could go stale** — a thread's last-updated time is now guaranteed to stay in sync with its runs, instead of occasionally missing an update.
- **Only the most recently opened browser tab received live updates** — if you had the app open in more than one tab, only the last one you opened would get live thread/run updates. All open tabs now update correctly.
- **App failed to load on deep links** — refreshing the page or opening a bookmarked link to anything other than the app's home view (e.g. a specific thread) could leave the app stuck with no data. This is now fixed.

---

## [0.0.7] - 2026-06-29

### Features

- **Additional repo groups now supported** — webhook events from a couple of additional internal repo groups are now reviewed alongside the existing set.

---

## [0.0.6] - 2026-06-26

### Fixes

- **Duplicate reviews triggered for the same MR** — multiple pushes in quick succession, or a push arriving while a review was already running, could trigger several concurrent reviews for the same MR. Reviews now correctly debounce: rapid pushes collapse into one, and pushes that arrive during an active review are queued and start as soon as the current one finishes (with newer pushes superseding older ones).
- **Graceful shutdown on restart** — active reviews were not stopped when the server shut down, causing the worker to hang until the review completed naturally. Reviews are now aborted on shutdown so the process exits promptly.

---

## [0.0.5] - 2026-06-26

### Features

- **Queue status panel** — the sessions list now shows a live system status panel with how many reviews are active, debouncing, or waiting for a free slot.
- **Review countdown** — when a re-review is debouncing, its thread row shows a live countdown to when it will start. When it is waiting behind other active reviews, it shows "Waiting for a free slot".

### Fixes

- **Reviews not respecting the concurrency limit** — all queued reviews were starting simultaneously instead of being capped at the configured limit. Reviews now correctly queue up and run at most 2 at a time.
- **Wrong review status notification** — the bot could send an "in progress" notification when a review had actually completed, or vice versa. This is now always correct.
- **Clearer review status notes** — the GitLab notes posted at the start, end, and failure of a review now have a proper heading ("Review in Progress", "Review Completed", "Review Failed") with a short description, instead of the default generic alert labels.
- **Re-reviews delayed unnecessarily** — pushing to an MR when no review was running would still wait 5 minutes before starting. It now starts immediately; the delay only applies when collapsing rapid successive pushes.
- **Deleting a thread leaves a review running** — deleting a thread now stops any active review immediately, freeing the worker slot instead of letting it run to completion against records that no longer exist. Queued reviews for the thread are also cancelled before they can start.
- **No loading state when opening a thread** — navigating into a thread showed the "Hi there!" empty state while history was loading, with no indicator that anything was happening. A loading animation now appears immediately and stays until the history (and any active stream) is ready.

---

## [0.0.4] - 2026-06-25

### Fixes

- **Reviews lost after a restart** — if the app restarted while a review was queued, that review would silently disappear. It now picks up and runs any missed reviews on startup.

---

## [0.0.3] - 2026-06-25

### Fixes

- **MR link opened the wrong page** — the merge request link in the chat header was pointing to the app itself instead of GitLab. It now goes to the correct GitLab MR page.

---

## [0.0.2] - 2026-06-24

### Features

- **Agent todo panel** — a side panel shows what the agent is planning to do next during a review, in real time.
- **Review timing breakdown** — you can now see how long each step of a review took, so it's easy to spot where time is spent.
- **Thread last-updated timestamp** — the thread list shows when each thread was last active.
- **MR link in chat header** — the chat view now includes a direct link to the merge request being reviewed.
- **Confirmation required for critical actions** — sensitive or destructive actions require a password before they go through.

### Fixes

- **Reviews triggered for merge-only commits** — the bot was kicking off reviews on commits with no real code changes (e.g. promotion merges). It now ignores these correctly.
- **Review comments clearer and more actionable** — the formatting and content of posted review notes have been improved.
- **Partial reviews posted** — in some cases only some review comments were posted before others failed. All comments are now submitted together or not at all.
- **Reviews getting stuck** — a review that failed mid-way could end up in a permanent limbo state. It now correctly shows as errored.
- **Opening a review before it starts** — you could click into a review that was still queued and hadn't run yet, showing an empty or broken view. This is now blocked.
- **Queued reviews silently dropped** — a crash in the background worker could cause queued reviews to disappear without any error. Fixed.
- **Negative review durations displayed** — review durations occasionally showed as negative numbers. This no longer happens.
- **Large MRs cut off mid-review** — reviews of large merge requests were sometimes stopped before the agent finished. The limit has been raised.
- **Failed steps not visible** — tool calls that errored during a review weren't visually distinguished from successful ones. They're now highlighted.

---

## [0.0.1] - 2026-06-12

Initial release, under the project's previous internal name.

### Features

- **Automatic MR reviews** — the bot listens for merge request events on GitLab and triggers an AI review automatically when an MR is opened, reopened, or updated.
- **AI-powered code review** — a multi-step agent reviews your code, posts notes directly on the MR, and manages review state end-to-end.
- **Multiple AI model support** — works with OpenRouter (GPT-4.1 Mini, Claude Sonnet 4.6) or a local Ollama instance (Qwen, Gemma).
- **Smart debouncing** — rapid pushes to the same MR are collapsed into a single review rather than triggering one per commit.
- **Review state survives restarts** — in-progress reviews are checkpointed so they can resume after a server restart.
- **Real-time monitoring UI** — a web UI lets you browse review threads, inspect what the agent did, and follow live reviews as they run.
- **Structured review format** — reviews follow a consistent format covering a summary, issues found, suggestions, and an overall verdict.
- **Auth-protected endpoints** — the API and webhooks are protected by separate auth tokens.
