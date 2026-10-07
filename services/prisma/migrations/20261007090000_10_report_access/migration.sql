-- Managers below the hospital level can read reports (who did what, on time
-- or not) for their own floor, ward, or department. New hospitals get this
-- from src/modules/roles/built-in-roles.ts.
INSERT INTO "RolePermission" ("id", "hospitalId", "roleId", "permissionKey")
SELECT gen_random_uuid(), r."hospitalId", r."id", 'analytics.read'
FROM "Role" r
WHERE r."systemKey" IN ('FLOOR_MANAGER', 'WARD_MANAGER', 'DEPARTMENT_SUPERVISOR')
  AND EXISTS (SELECT 1 FROM "Permission" p WHERE p."key" = 'analytics.read')
ON CONFLICT ("hospitalId", "roleId", "permissionKey") DO NOTHING;

-- Faster reports over a date range and per-person history.
CREATE INDEX IF NOT EXISTS "ServiceRequest_hospitalId_submittedAt_idx"
    ON "ServiceRequest"("hospitalId", "submittedAt");
CREATE INDEX IF NOT EXISTS "RequestEvent_hospitalId_actorId_idx"
    ON "RequestEvent"("hospitalId", "actorId");
