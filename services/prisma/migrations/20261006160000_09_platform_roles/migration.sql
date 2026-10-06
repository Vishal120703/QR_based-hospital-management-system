-- SaaS platform operators, department-level authorization, and the built-in
-- role hierarchy (Hospital Manager > Floor/Ward Manager, Department
-- Supervisor > Care Staff) for every hospital.

-- CreateEnum
CREATE TYPE "RoleScopeLevel" AS ENUM ('HOSPITAL', 'FLOOR', 'WARD', 'DEPARTMENT');

-- AlterEnum
ALTER TYPE "AuditActorType" ADD VALUE 'PLATFORM';

-- AlterEnum
ALTER TYPE "ScopeType" ADD VALUE 'DEPARTMENT';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorPlatformUserId" UUID;

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "scopeLevel" "RoleScopeLevel" NOT NULL DEFAULT 'HOSPITAL',
ADD COLUMN     "systemKey" TEXT;

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSession_tokenHash_key" ON "PlatformSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlatformSession_userId_idx" ON "PlatformSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_hospitalId_systemKey_key" ON "Role"("hospitalId", "systemKey");

-- AddForeignKey
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PlatformAdmin"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A platform action is recorded against the hospital it changed.
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_check" CHECK (
    -- Compared as text: a new enum value cannot be used in the transaction
    -- that adds it.
    ("actorType"::text <> 'PLATFORM' OR "actorPlatformUserId" IS NOT NULL)
);

-- Built-in roles for hospitals created before this migration. New hospitals
-- get them from createBuiltInRoles() in src/modules/roles/built-in-roles.ts.
-- The bootstrap "Hospital Admin" role becomes the locked Hospital Manager.
UPDATE "Role" AS r
SET "systemKey" = 'HOSPITAL_MANAGER',
    "description" = 'Runs the whole hospital: setup, staff, roles and access, QR labels, and requests.',
    "name" = CASE
        WHEN EXISTS (
            SELECT 1 FROM "Role" o WHERE o."hospitalId" = r."hospitalId" AND o."name" = 'Hospital Manager'
        ) THEN r."name"
        ELSE 'Hospital Manager'
    END
WHERE r."name" = 'Hospital Admin';

INSERT INTO "Role" ("id", "hospitalId", "name", "description", "active", "scopeLevel", "systemKey", "createdAt", "updatedAt")
SELECT gen_random_uuid(), h."id", d.name, d.description, true, d.level::"RoleScopeLevel", d.key, now(), now()
FROM "Hospital" h
CROSS JOIN (VALUES
    ('FLOOR_MANAGER', 'Floor Manager', 'Admits and discharges patients and assigns requests on one floor.', 'FLOOR'),
    ('WARD_MANAGER', 'Ward Manager', 'Admits and discharges patients and assigns requests in one ward or unit.', 'WARD'),
    ('DEPARTMENT_SUPERVISOR', 'Department Supervisor', 'Assigns and closes one department''s requests across the hospital.', 'DEPARTMENT'),
    ('CARE_STAFF', 'Care Staff', 'Accepts, starts, and completes the requests assigned to them.', 'HOSPITAL')
) AS d(key, name, description, level)
WHERE NOT EXISTS (
    SELECT 1 FROM "Role" r
    WHERE r."hospitalId" = h."id" AND (r."systemKey" = d.key OR r."name" = d.name)
);

INSERT INTO "RolePermission" ("id", "hospitalId", "roleId", "permissionKey")
SELECT gen_random_uuid(), r."hospitalId", r."id", p.permission
FROM "Role" r
JOIN (VALUES
    ('FLOOR_MANAGER', 'location.read'),
    ('FLOOR_MANAGER', 'bed.read'),
    ('FLOOR_MANAGER', 'bedSession.manage'),
    ('FLOOR_MANAGER', 'staff.read'),
    ('FLOOR_MANAGER', 'request.read'),
    ('FLOOR_MANAGER', 'request.assign'),
    ('FLOOR_MANAGER', 'request.close'),
    ('FLOOR_MANAGER', 'request.cancel'),
    ('WARD_MANAGER', 'location.read'),
    ('WARD_MANAGER', 'bed.read'),
    ('WARD_MANAGER', 'bedSession.manage'),
    ('WARD_MANAGER', 'staff.read'),
    ('WARD_MANAGER', 'request.read'),
    ('WARD_MANAGER', 'request.assign'),
    ('WARD_MANAGER', 'request.close'),
    ('WARD_MANAGER', 'request.cancel'),
    ('DEPARTMENT_SUPERVISOR', 'staff.read'),
    ('DEPARTMENT_SUPERVISOR', 'request.read'),
    ('DEPARTMENT_SUPERVISOR', 'request.assign'),
    ('DEPARTMENT_SUPERVISOR', 'request.close'),
    ('DEPARTMENT_SUPERVISOR', 'request.cancel'),
    ('CARE_STAFF', 'request.read'),
    ('CARE_STAFF', 'request.accept'),
    ('CARE_STAFF', 'request.start'),
    ('CARE_STAFF', 'request.complete'),
    ('CARE_STAFF', 'request.reject')
) AS p(key, permission) ON r."systemKey" = p.key
WHERE EXISTS (SELECT 1 FROM "Permission" x WHERE x."key" = p.permission)
ON CONFLICT ("hospitalId", "roleId", "permissionKey") DO NOTHING;
