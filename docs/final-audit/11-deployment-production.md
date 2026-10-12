# Deployment — baseline only

Status: PARTIAL. Stage 12 not executed. render.yaml and frontend/vercel.json exist; CI exists with PostgreSQL 17 and Node 24.19.0. The API blueprint uses npm run start:prod (migrate deploy then server), /health, an externally supplied public web URL, and TRUST_PROXY=3. The frontend has SPA rewrites and immutable asset caching.

These files' presence and a local build are not hosted-production verification. Actual ingress/proxy hop assumptions, readiness choice, CORS values, security headers, graceful in-flight shutdown, dependency failure, backups, secrets, multi-instance behavior and hosting-plan constraints remain unverified. No deployment was attempted and no user servers were stopped or started.
