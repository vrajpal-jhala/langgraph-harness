# Getting Started

## Prerequisites

- Node.js 22+
- Docker (for PostgreSQL, Redis, and Lightpanda)
- A GitLab or GitHub account for the bot to act as (or one of each) — see [step 2](#_2-pick-gitlab-github-or-both)
- An LLM backend: an OpenRouter/Gemini/Groq API key, or a local Ollama/sglang instance

## 1. Clone and install

```bash
git clone https://github.com/vrajpal-jhala/langgraph-harness.git
cd langgraph-harness
npm install
```

`postinstall` also installs `backend/` and `frontend/` dependencies.

## 2. Pick GitLab, GitHub, or both

A deployment needs at least one git provider fully configured. You can set up GitLab, GitHub, or both; whichever you leave out is switched off entirely — no sign-in button, no webhook route, no workflows that depend on it. Setting only some of a provider's variables is an error: the backend refuses to start and names the ones still missing.

Not every feature exists on both yet:

| Feature                                                      | GitLab | GitHub |
| ------------------------------------------------------------ | ------ | ------ |
| Sign-in                                                      | ✓      | ✓      |
| Issue resolve — assign an issue to the bot, get a draft back | ✓      | ✓      |
| Merge request review                                         | ✓      | —      |
| Task resolve — ad-hoc tasks and schedules from the UI        | ✓      | ✓      |
| Follow-up runs from comments mentioning the bot on its draft | ✓      | ✓      |
| Chat's GitLab tools (acting on GitLab as the signed-in user) | ✓      | —      |

Chat itself works with either provider; only its GitLab tools need GitLab. On a GitHub-only deployment, the GitLab tools toggle in Chat is hidden.

## 3a. GitLab setup

**Bot account and token.** Use a dedicated GitLab account for the bot — it's the account whose avatar shows up on review comments and draft merge requests. On gitlab.com (or your self-hosted instance): **User Settings → Access Tokens**, scope `api`. Give the account at least Developer access on the projects it should work in.

**OAuth application (sign-in).** Sign-in, and per-user GitLab actions taken on your behalf from Chat, go through GitLab OAuth, separate from the bot's token.

1. **User Settings → Applications** (or **Admin Area → Applications** for an instance-wide app).
2. Name it anything (e.g. `langgraph-harness`).
3. Redirect URI: `http://localhost:5173/auth/callback/gitlab` for local dev — `APP_URL` from your `.env` plus `/auth/callback/gitlab`. For a deployed instance, use that instance's own URL instead.
4. Scope: `api` (OAuth login also stores a per-user token used for on-behalf-of actions).
5. Save, and copy the generated **Application ID** and **Secret**.

**Webhook.** On each project (**Settings → Webhooks**), point a webhook at `<your-instance>/webhooks/gitlab`, triggered on **Merge request events**, **Comments** and **Issues events**. Under **Signing token**, select **Generate signing token** and copy it into `GITLAB_WEBHOOK_TOKENS`; GitLab shows it only once. The backend checks every delivery's signature, so the plain **Secret token** field isn't used. Signing tokens need GitLab 19.1 or later.

| Variable                     | Value                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| `GITLAB_PAT`                 | The bot's access token                                                                           |
| `GITLAB_BOT_USERNAME`        | The bot account's username                                                                       |
| `GITLAB_OAUTH_CLIENT_ID`     | The OAuth application's ID                                                                       |
| `GITLAB_OAUTH_CLIENT_SECRET` | The OAuth application's secret                                                                   |
| `GITLAB_WEBHOOK_TOKENS`      | The webhook's signing token (starts with `whsec_`); comma-separate several for multiple webhooks |
| `GITLAB_ADMIN_USERNAMES`     | GitLab `@handle`s that get admin rights — at least your own                                      |

Self-hosted GitLab: also set `GITLAB_API_URL` (defaults to `https://gitlab.com/api/v4`).

## 3b. GitHub setup

**Bot account and token.** Use a dedicated GitHub account for the bot, added to the repositories (or organization) it should work in with write access — it's the account that comments on issues and opens draft pull requests. Create a token for it under **Settings → Developer settings → Personal access tokens**:

- Classic token: `repo` scope.
- Fine-grained token: repository access to the repos it works in, with **Contents**, **Issues**, and **Pull requests** set to read and write (**Metadata** read comes with them).

Either way, add workflow write access (`workflow` scope, or **Workflows** read and write) if the bot should be able to change GitHub Actions files.

**OAuth app (sign-in).** **Settings → Developer settings → OAuth Apps → New OAuth App**, with the callback URL `http://localhost:5173/auth/callback/github` (again `APP_URL` plus `/auth/callback/github`). Copy the **Client ID** and generate a **Client secret**. Sign-in supports github.com only, not GitHub Enterprise.

**Webhook.** On each repository (**Settings → Webhooks**) or once on the organization, add a webhook pointing at `<your-instance>/webhooks/github`, content type `application/json`, with a secret of your choosing, sending **Issues**, **Pull requests**, **Issue comments**, **Pull request review comments** and **Pull request reviews** events.

For local dev, GitHub can't reach `localhost`, so forward events instead with the [`gh webhook`](https://github.com/cli/gh-webhook) extension:

```bash
gh extension install cli/gh-webhook
gh webhook forward --repo=<owner>/<repo> --events=issues,pull_request \
  --url=http://localhost:3698/webhooks/github --secret=<your GITHUB_WEBHOOK_TOKENS value>
```

| Variable                     | Value                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `GITHUB_PAT`                 | The bot's token                                                                |
| `GITHUB_BOT_USERNAME`        | The bot account's login                                                        |
| `GITHUB_OAUTH_CLIENT_ID`     | The OAuth app's client ID                                                      |
| `GITHUB_OAUTH_CLIENT_SECRET` | The OAuth app's client secret                                                  |
| `GITHUB_WEBHOOK_TOKENS`      | The webhook secret; comma-separate several if your webhooks use different ones |
| `GITHUB_ADMIN_USERNAMES`     | GitHub logins that get admin rights — at least your own                        |

Optionally set `GITHUB_BOT_NAME` and `GITHUB_BOT_EMAIL` for the bot's commits. Draft pull requests on private repos need a paid GitHub plan; public repos work on any plan. Without one, the bot opens a regular pull request instead, and its status comment on the issue says it isn't ready to merge.

### Signing in with both

When both providers are configured, a person whose GitHub and GitLab accounts share a verified email lands in the same account whichever button they use. Otherwise they can connect the other provider from **Settings** — the emails don't have to match there. Admin rights are checked per provider: a GitHub login only grants admin through `GITHUB_ADMIN_USERNAMES`, a GitLab username only through `GITLAB_ADMIN_USERNAMES`. With both connected, either one being listed makes the account an admin.

## 4. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Fill in the variables for the provider(s) you picked in step 3, plus these shared ones:

| Variable                                                                                                | Where it comes from                               |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `SESSION_SECRET`                                                                                        | Any random string (`openssl rand -hex 32`)        |
| `SECRETS_ENCRYPTION_KEY`                                                                                | Any random string, separate from `SESSION_SECRET` |
| One of `OPENROUTER_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` / `OLLAMA_BASE_URL` / `SGLANG_BASE_URL` | Your LLM backend                                  |

The full reference — every variable, what it defaults to, and why — is in [`backend/README.md`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/backend/README.md).

## 5. Run it

```bash
npm run dev
```

This brings up Postgres/Redis/the auxiliary services via Docker Compose, runs pending migrations, and starts both the backend (`:3698`) and frontend (`:5173`). Open `http://localhost:5173` and sign in with whichever provider you configured.

## 6. Trigger a run

- **GitLab:** with the webhook from step 3a in place, opening or updating a merge request triggers a review, and assigning an issue to the bot account starts an issue-resolve run that ends in a draft merge request.
- **GitHub:** with the webhook (or `gh webhook forward`) from step 3b running, assigning an issue to the bot account starts an issue-resolve run that ends in a draft pull request.

For local testing without a real GitLab webhook, [`scripts/test.sh`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/scripts/test.sh) posts synthetic GitLab webhook payloads straight at your local backend. They're unsigned, so this works in dev mode (`NODE_ENV=development`), which skips the signature check. It's useful for exercising the routing/filter logic, though the agent still calls the real GitLab API to fetch context, so it needs a real project and merge request to point at.

The demo fixtures in [`demo-fixtures/`](https://github.com/vrajpal-jhala/langgraph-harness/tree/main/demo-fixtures), and its `seed-demo.mjs` script, only seed a GitLab project for now.
