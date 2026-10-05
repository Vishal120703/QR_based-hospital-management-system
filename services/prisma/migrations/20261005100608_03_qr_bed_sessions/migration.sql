-- CreateEnum
CREATE TYPE "QrCodeStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "BedSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateTable
CREATE TABLE "BedQrCode" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "QrCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BedQrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BedSession" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "status" "BedSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "startedByMembershipId" UUID NOT NULL,
    "closedByMembershipId" UUID,

    CONSTRAINT "BedSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "bedSessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BedQrCode_tokenHash_key" ON "BedQrCode"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "BedQrCode_hospitalId_id_key" ON "BedQrCode"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BedQrCode_hospitalId_bedId_key" ON "BedQrCode"("hospitalId", "bedId");

-- CreateIndex
CREATE INDEX "BedSession_hospitalId_status_startedAt_idx" ON "BedSession"("hospitalId", "status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BedSession_hospitalId_id_key" ON "BedSession"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BedSession_hospitalId_bedId_id_key" ON "BedSession"("hospitalId", "bedId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE INDEX "GuestSession_hospitalId_bedSessionId_idx" ON "GuestSession"("hospitalId", "bedSessionId");

-- CreateIndex
CREATE INDEX "GuestSession_hospitalId_bedId_idx" ON "GuestSession"("hospitalId", "bedId");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "BedQrCode" ADD CONSTRAINT "BedQrCode_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedQrCode" ADD CONSTRAINT "BedQrCode_hospitalId_bedId_fkey" FOREIGN KEY ("hospitalId", "bedId") REFERENCES "Bed"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "BedSession" ADD CONSTRAINT "BedSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BedSession" ADD CONSTRAINT "BedSession_hospitalId_bedId_fkey" FOREIGN KEY ("hospitalId", "bedId") REFERENCES "Bed"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_hospitalId_bedId_bedSessionId_fkey" FOREIGN KEY ("hospitalId", "bedId", "bedSessionId") REFERENCES "BedSession"("hospitalId", "bedId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- At most one ACTIVE session per bed. Prisma cannot express partial indexes,
-- and it leaves this index untouched in later generated migrations.
CREATE UNIQUE INDEX "BedSession_one_active_per_bed" ON "BedSession"("hospitalId", "bedId") WHERE "status" = 'ACTIVE';

-- Status and timestamps must agree.
ALTER TABLE "BedSession" ADD CONSTRAINT "BedSession_status_endedAt_check"
  CHECK (("status" = 'ACTIVE' AND "endedAt" IS NULL) OR ("status" = 'CLOSED' AND "endedAt" IS NOT NULL));
ALTER TABLE "BedQrCode" ADD CONSTRAINT "BedQrCode_status_revokedAt_check"
  CHECK (("status" = 'ACTIVE' AND "revokedAt" IS NULL) OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL));
ALTER TABLE "BedQrCode" ADD CONSTRAINT "BedQrCode_version_check" CHECK ("version" >= 1);

-- New permission. Roles that could already manage beds keep full bed control.
INSERT INTO "Permission" ("key", "description")
VALUES ('bedSession.manage', 'Start and close bed sessions')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("id", "hospitalId", "roleId", "permissionKey")
SELECT gen_random_uuid(), "hospitalId", "roleId", 'bedSession.manage'
FROM "RolePermission"
WHERE "permissionKey" = 'bed.manage'
ON CONFLICT ("hospitalId", "roleId", "permissionKey") DO NOTHING;
