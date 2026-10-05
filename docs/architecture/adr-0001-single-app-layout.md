# ADR 0001: One backend service and one frontend app

Date: 2026-10-05  
Status: Accepted by user direction

## Decision

CARE QR V1 uses `backend/`, `frontend/`, and `docs/` as its only application-level directories. The backend is one deployable service with internal domain modules. The frontend is one app with patient, staff, and administration routes added in their planned phases.

The Phase 1 split into three web apps, an API service, a worker service, and a shared package is superseded. Background jobs may run within the backend process initially. A separate worker process or microservice is added only after a concrete operational need and a new decision record.

## Reasons

The user requested one service, one frontend, and a small root structure. Internal module ownership, tenant rules, tests, and database boundaries remain in force. This layout avoids empty workspace shells while leaving a clear extraction path if later scale requires it.

## Consequences

- Root scripts, CI, and deployment instructions target `backend/` and `frontend/`.
- Feature folders are created when their phase begins; placeholder directories are not kept.
- Redis, BullMQ, and Socket.IO are infrastructure choices for later functionality, not additional services or authoritative stores.
- The migration history is preserved while moving Prisma from `services/api/prisma` to `backend/prisma`.
