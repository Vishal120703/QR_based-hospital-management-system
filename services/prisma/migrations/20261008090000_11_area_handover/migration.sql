-- Floor and Ward Managers and Department Supervisors can hand accepted work
-- to another eligible staff member in their own area (for example at a shift
-- change). New hospitals get this from src/modules/roles/built-in-roles.ts.
INSERT INTO "RolePermission" ("id", "hospitalId", "roleId", "permissionKey")
SELECT gen_random_uuid(), r."hospitalId", r."id", 'request.transfer'
FROM "Role" r
WHERE r."systemKey" IN ('FLOOR_MANAGER', 'WARD_MANAGER', 'DEPARTMENT_SUPERVISOR')
  AND EXISTS (SELECT 1 FROM "Permission" p WHERE p."key" = 'request.transfer')
ON CONFLICT ("hospitalId", "roleId", "permissionKey") DO NOTHING;
