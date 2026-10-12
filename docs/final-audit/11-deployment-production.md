# Deployment — baseline only

Status: PARTIAL. Stage 12 not executed. render.yaml and frontend/vercel.json exist; CI exists with PostgreSQL 17 and Node 24.19.0. The API blueprint uses npm run start:prod (migrate deploy then server), /health, an externally supplied public web URL, and TRUST_PROXY=3. The frontend has SPA rewrites and immutable asset caching.

These files' presence and a local build are not hosted-production verification. Actual ingress/proxy hop assumptions, readiness choice, CORS values, security headers, graceful in-flight shutdown, dependency failure, backups, secrets, multi-instance behavior and hosting-plan constraints remain unverified. No deployment was attempted and no user servers were stopped or started.

## Update 2026-10-12

- `render.yaml` no longer creates a Render database or points DATABASE_URL at one: the live API uses Neon (seen in the Render deploy log), and a Blueprint sync could have replaced its database address. DATABASE_URL is entered once and not overwritten.
- Shutdown is graceful (no new requests, in-progress ones finish within SHUTDOWN_TIMEOUT_SECONDS, then the SLA worker and database close, once); start-up failures such as a busy port are one plain line and exit 1 with opened resources closed. `/ready` answers 503 within 3 seconds if a dependency hangs; `/health` stays liveness-only for Render.
- `docs/deployment.md` now covers deploy order (API first), rollback, monitoring, and a provider-independent backup and restore-test procedure.
- Still unverified: hosted behavior (proxy hops, a real redeploy's shutdown, multi-instance), an actual uptime monitor, backups taken and a restore tested by the operator, and the free-plan sleep (the SLA worker pauses with the API).
