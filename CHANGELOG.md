# Changelog

All notable changes to langgraph-harness are documented here.

## [Unreleased]

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
