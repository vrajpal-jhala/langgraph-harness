# Getting Started

## Prerequisites

- Node.js 22+
- Docker (for PostgreSQL, Redis, and Lightpanda)
- A GitLab personal access token with `api` scope
- A GitLab OAuth application (for sign-in) — see below
- An LLM backend: an OpenRouter API key, or a local Ollama/sglang instance

## 1. Clone and install

```bash
git clone https://github.com/vrajpal-jhala/langgraph-harness.git
cd langgraph-harness
npm install
```

`postinstall` also installs `backend/` and `frontend/` dependencies.

## 2. Create a GitLab personal access token

On gitlab.com (or your self-hosted instance): **User Settings → Access Tokens**, scope `api`. This is the identity the bot acts as — the account whose avatar shows up on review comments and draft MRs.

## 3. Create a GitLab OAuth application

Sign-in (and per-user GitLab actions taken on your behalf) go through GitLab OAuth, separate from the bot's PAT above.

1. **User Settings → Applications** (or **Admin Area → Applications** for an instance-wide app).
2. Name it anything (e.g. `langgraph-harness`).
3. Redirect URI: `http://localhost:5173/auth/callback/gitlab` for local dev — this must match `APP_URL` in your `.env` plus `/auth/callback/gitlab`. For a deployed instance, use that instance's own URL instead.
4. Scope: `api` (the same scope as the bot's PAT — OAuth login also stores a per-user token used for on-behalf-of actions).
5. Save, and copy the generated **Application ID** and **Secret**.

## 4. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Fill in at minimum:

| Variable                                                            | Where it comes from                                                          |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GITLAB_PAT`                                                        | Step 2                                                                       |
| `GITLAB_OAUTH_CLIENT_ID`                                            | Step 3                                                                       |
| `GITLAB_OAUTH_CLIENT_SECRET`                                        | Step 3                                                                       |
| `WEBHOOK_TOKENS`                                                    | Any secret string you choose — GitLab webhooks send it back for verification |
| `SESSION_SECRET`                                                    | Any random string (`openssl rand -hex 32`)                                   |
| `SECRETS_ENCRYPTION_KEY`                                            | Any random string, separate from `SESSION_SECRET`                            |
| `ADMIN_GITLAB_USERNAMES`                                            | Your own GitLab `@handle`                                                    |
| One of `OPENROUTER_API_KEY` / `OLLAMA_BASE_URL` / `SGLANG_BASE_URL` | Your LLM backend                                                             |

The full reference — every variable, what it defaults to, and why — is in [`backend/README.md`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/backend/README.md).

## 5. Run it

```bash
npm run dev
```

This brings up Postgres/Redis/the auxiliary services via Docker Compose, runs pending migrations, and starts both the backend (`:3698`) and frontend (`:5173`). Open `http://localhost:5173` and sign in with GitLab.

## 6. Trigger a review

In production, reviews fire automatically: add a webhook on your GitLab project (**Settings → Webhooks**) pointing at `<your-instance>/webhooks/gitlab`, secret matching `WEBHOOK_TOKENS`, triggered on merge request and note events.

For local testing without a real webhook, [`scripts/test.sh`](https://github.com/vrajpal-jhala/langgraph-harness/blob/main/scripts/test.sh) posts synthetic GitLab webhook payloads straight at your local backend — useful for exercising the routing/filter logic, though the agent still calls the real GitLab API to fetch context, so it needs a real project/MR to point at.
