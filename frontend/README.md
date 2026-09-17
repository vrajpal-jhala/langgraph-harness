# langgraph-harness Frontend

React admin UI for monitoring langgraph-harness agent runs, and for chatting directly with the GitLab-aware assistant outside a merge request. A persistent navigation shell (collapsible sidebar on desktop, drawer on mobile) links the app's pages. MR reviews are still created exclusively via webhooks; Chat is the one page where you submit queries directly from the UI.

**Pages:**

- **Dashboard** — Active/total user counts, plus live queue status (active/waiting/delayed jobs) with a list linking into their threads.
- **Threads** — Filterable, paginated list of threads (by status and project), with live duration counters and silent live updates over the websocket connection.
- **Thread detail** — A Runs sidebar (a drawer on tablet/mobile) plus **Summary** (final agent output, live "current step" while running, or the error if failed) and **Debug** (full tool/node event timeline with timings) tabs. A "Memories" row next to Review and Issue Resolve threads counts project-memory activity — pending mid-run and what the curator decided (new/updated/retired/skipped) once the run finishes. Each checkpoint has a "Retry from here" button that spawns a new run branching from that point; retried runs show a "Branched from checkpoint above" header. A failed run with no checkpoint instead shows a "Retry" button that reruns the original input from the beginning. Retry is unavailable once a thread has gone inactive long enough to be archived. A collapsible panel shows the agent's live todo list.
- **Chat** — Paginated list of your own chat threads; open one to converse directly with the assistant, toggling server tools, GitLab tools, fetching web pages, and extended reasoning per message, with image attachments and a model picker in the composer. The assistant always has access to your own conversation history — it can search your past chats by title or by what was actually said, and it saves and recalls durable personal facts about you directly. Server tools add the ability to search or inspect past MR reviews too. Fetching web pages lets it render a URL you give it in a real browser and read its main content. A tool call that needs approval pauses the run until you approve or reject it — unless the thread has since gone inactive long enough to be archived, in which case resuming it is blocked and you'll need to start a new chat.
- **Schedules** — Admin-only: create a Task Resolve prompt to run once at a chosen time or on a recurring daily/weekly/monthly cadence, in the project's own timezone. Each card shows status, next-run time, and a run history list; pause, resume, cancel, and run-now controls act on the schedule directly. Non-admins see the list read-only.
- **Workflows** — Lists available workflows with live status and run counts; the detail page renders the workflow's execution graph as a Mermaid diagram.
- **Memories** — A toggle switches between Project memories (durable facts the agent has accumulated across reviews — a project picker shows a count badge per project and sorts ones with memories to the top) and My memories (your own personal facts saved from chat). Either way, memories are listed grouped by category (knowledge/preference/lesson/decision) with a category filter, each with its supporting evidence and where it came from, plus a delete button to remove a single entry — admins can delete any memory, and a user can also delete their own personal memories without needing an admin.
- **Settings** — A Connections section shows whether the signed-in user's GitLab link is still working, with a "Reconnect" button that re-authorizes it without signing out of langgraph-harness.
- **Analytics** — A Reviews/Chat/Issue Resolve toggle switches the reliability (success rate, duration, error breakdown), efficiency (LLM/tool calls, tokens), and guardrail-activity stats between the three workflow kinds. Trend charts show average duration, run volume, success rate, queue wait (time spent waiting behind the review queue's concurrency cap), and backend wait (time spent queued behind a self-hosted LLM's concurrency cap) over the last 30 days. A per-repo table (Reviews and Issue Resolve only) breaks down run volume and failures by GitLab project, and a usage row (users, reviews, chats, project/personal memories) stays visible regardless of the toggle.
- **Monitoring** — Admin-only page showing a point-in-time snapshot of sandbox fleet resource usage, per-container CPU/memory for the rest of the compose stack, and disk usage per data directory. Fetched once on load, no auto-refresh.
- Agents is present in the nav but not yet implemented (placeholder for a future phase — see `docs/phases/`).

**UI highlights:**

- Guided product tour — first-time walkthrough of the app, replayable anytime from the help button
- GitLab sign-in — required to use the app; destructive actions (abort, delete) are restricted to specific GitLab accounts
- Confirmation popup — shown before a destructive action goes through
- Errored tool calls highlighted — visually distinct from successful ones
- Crash recovery screen — a friendly fallback with a reload button and a one-click crash report copy, instead of a blank page, if something goes wrong
- Dark theme with Mantine-based design system

## Setup

```bash
npm install
```

No environment configuration needed for local development — `GITLAB_URL` is read from `backend/.env` automatically by Vite and baked into the build at compile time.

## Scripts

| Script            | Description                               |
| ----------------- | ----------------------------------------- |
| `npm run dev`     | Start Vite dev server (default port 5173) |
| `npm run build`   | Type-check and bundle for production      |
| `npm run preview` | Preview production build                  |
| `npm run lint`    | Run ESLint                                |

## Stack

- **React 19** with the React Compiler (Babel)
- **react-router-dom** for client-side routing between pages
- **Mantine** (`@mantine/core`, `@mantine/hooks`, `@mantine/notifications`, `@mantine/dates`) for the component library and theming, with **@tabler/icons-react** for icons
- **react-joyride** for the guided product tour
- **mermaid** for rendering workflow execution graphs
- **Elysia Eden** for type-safe API client
- **react-markdown** + **remark-gfm** for message rendering
- **Sass** — modular SCSS under `src/styles/{base,components,pages}`, layered on top of Mantine's CSS variables
- **Vite** with proxy config for `/api` and `/ws`
