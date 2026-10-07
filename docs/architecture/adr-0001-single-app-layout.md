# ADR 0001: One backend service and one frontend app

Date: 2026-10-05  
Status: Accepted by user direction

## Decision

CARE QR V1 uses one deployable backend service with internal domain modules and one frontend app. The original simplified layout used `backend/`, `frontend/`, and `docs/`; the amendment below records the current `services/` and `frontend/` layout. Patient, staff, and administration routes share the same frontend.

The Phase 1 split into three web apps, an API service, a worker service, and a shared package is superseded. Background jobs may run within the backend process initially. A separate worker process or microservice is added only after a concrete operational need and a new decision record.

## Reasons

The user requested one service, one frontend, and a small root structure. Internal module ownership, tenant rules, tests, and database boundaries remain in force. This layout avoids empty workspace shells while leaving a clear extraction path if later scale requires it.

## Consequences

- In the original simplified layout, scripts and deployment instructions targeted `backend/` and `frontend/`; current commands run inside `services/` and `frontend/`.
- Feature folders are created when their phase begins; placeholder directories are not kept.
- Redis, BullMQ, and Socket.IO are infrastructure choices for later functionality, not additional services or authoritative stores.
- The migration history is preserved while moving Prisma from `services/api/prisma` to `backend/prisma`.

## Amendment 2026-10-05: two application folders

At the user's direction the application lives in only `frontend/` and `services/`; documentation later returned to a root `docs/` folder. This did not add another application or service.

- `backend/` was renamed `services/`. It is still one deployable backend service.
- Each folder is self-contained, with its own `package.json` and lockfile. The npm workspace root, shared `tsconfig.base.json`, and root ESLint config were folded into `services/`.
- Architecture docs moved to `services/docs/architecture` at that point and now live in root `docs/architecture`.
- `frontend/` is the single React app. Phases 4–6 added staff administration, QR scanning, bed/guest sessions, and a patient catalog preview. Phase 8 later added request submission and tracking.
- The unused Docker Compose file and `.editorconfig` were removed; local PostgreSQL and Redis can come from any installation.

## Amendment 2026-10-07: explicit layers, same deployables

Each backend domain now exposes routes, controllers, schemas, services, repositories, and a small public `index.ts` as needed. `src/container.ts` assembles the modules. The frontend groups pages by feature inside the same React app; `docs/` holds architecture, data-flow, and database diagrams. The deployment boundary remains **one backend and one frontend**. See the [current layout](./README.md#6-folder-structure).
