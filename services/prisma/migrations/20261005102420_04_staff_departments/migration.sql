-- CreateEnum
CREATE TYPE "DutyStatus" AS ENUM ('ON_DUTY', 'OFF_DUTY');

-- AlterTable
ALTER TABLE "HospitalMembership" ADD COLUMN     "dutyChangedAt" TIMESTAMP(3),
ADD COLUMN     "dutyStatus" "DutyStatus" NOT NULL DEFAULT 'OFF_DUTY';

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffDepartment" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffDepartment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLocationScope" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "floorId" UUID,
    "wardId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLocationScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "departmentId" UUID,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByMembershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_hospitalId_id_key" ON "Department"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Department_hospitalId_code_key" ON "Department"("hospitalId", "code");

-- CreateIndex
CREATE INDEX "StaffDepartment_hospitalId_departmentId_idx" ON "StaffDepartment"("hospitalId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffDepartment_hospitalId_membershipId_departmentId_key" ON "StaffDepartment"("hospitalId", "membershipId", "departmentId");

-- CreateIndex
CREATE INDEX "StaffLocationScope_hospitalId_floorId_idx" ON "StaffLocationScope"("hospitalId", "floorId");

-- CreateIndex
CREATE INDEX "StaffLocationScope_hospitalId_wardId_idx" ON "StaffLocationScope"("hospitalId", "wardId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLocationScope_hospitalId_id_key" ON "StaffLocationScope"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLocationScope_hospitalId_membershipId_floorId_key" ON "StaffLocationScope"("hospitalId", "membershipId", "floorId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLocationScope_hospitalId_membershipId_wardId_key" ON "StaffLocationScope"("hospitalId", "membershipId", "wardId");

-- CreateIndex
CREATE INDEX "Shift_hospitalId_membershipId_startsAt_idx" ON "Shift"("hospitalId", "membershipId", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_hospitalId_startsAt_idx" ON "Shift"("hospitalId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Shift_hospitalId_id_key" ON "Shift"("hospitalId", "id");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffDepartment" ADD CONSTRAINT "StaffDepartment_hospitalId_membershipId_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffDepartment" ADD CONSTRAINT "StaffDepartment_hospitalId_departmentId_fkey" FOREIGN KEY ("hospitalId", "departmentId") REFERENCES "Department"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffLocationScope" ADD CONSTRAINT "StaffLocationScope_hospitalId_membershipId_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffLocationScope" ADD CONSTRAINT "StaffLocationScope_hospitalId_floorId_fkey" FOREIGN KEY ("hospitalId", "floorId") REFERENCES "Floor"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StaffLocationScope" ADD CONSTRAINT "StaffLocationScope_hospitalId_wardId_fkey" FOREIGN KEY ("hospitalId", "wardId") REFERENCES "Ward"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_hospitalId_membershipId_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_hospitalId_departmentId_fkey" FOREIGN KEY ("hospitalId", "departmentId") REFERENCES "Department"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- Coverage shape: HOSPITAL has no location; FLOOR has only a floor; WARD has only a ward.
ALTER TABLE "StaffLocationScope" ADD CONSTRAINT "StaffLocationScope_shape_check" CHECK (
  ("scopeType" = 'HOSPITAL' AND "floorId" IS NULL AND "wardId" IS NULL) OR
  ("scopeType" = 'FLOOR' AND "floorId" IS NOT NULL AND "wardId" IS NULL) OR
  ("scopeType" = 'WARD' AND "wardId" IS NOT NULL AND "floorId" IS NULL)
);

-- At most one hospital-wide coverage row per staff member.
CREATE UNIQUE INDEX "StaffLocationScope_one_hospital_scope" ON "StaffLocationScope"("hospitalId", "membershipId") WHERE "scopeType" = 'HOSPITAL';

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_period_check" CHECK ("endsAt" > "startsAt");
