-- CreateEnum
CREATE TYPE "RequestPriority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "EscalationTarget" AS ENUM ('ASSIGNEE', 'ROLE');

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "emergencyNotice" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "slaPolicyId" UUID NOT NULL,
    "escalationPolicyId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priority" "RequestPriority" NOT NULL DEFAULT 'NORMAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicyVersion" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "slaPolicyId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptMinutes" INTEGER NOT NULL,
    "completeMinutes" INTEGER NOT NULL,
    "createdByMembershipId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlaPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationPolicy" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationLevel" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "escalationPolicyId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "afterMinutes" INTEGER NOT NULL,
    "targetType" "EscalationTarget" NOT NULL,
    "roleId" UUID,

    CONSTRAINT "EscalationLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_hospitalId_id_key" ON "ServiceCategory"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategory_hospitalId_name_key" ON "ServiceCategory"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "ServiceItem_hospitalId_categoryId_idx" ON "ServiceItem"("hospitalId", "categoryId");

-- CreateIndex
CREATE INDEX "ServiceItem_hospitalId_departmentId_idx" ON "ServiceItem"("hospitalId", "departmentId");

-- CreateIndex
CREATE INDEX "ServiceItem_hospitalId_slaPolicyId_idx" ON "ServiceItem"("hospitalId", "slaPolicyId");

-- CreateIndex
CREATE INDEX "ServiceItem_hospitalId_escalationPolicyId_idx" ON "ServiceItem"("hospitalId", "escalationPolicyId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_hospitalId_id_key" ON "ServiceItem"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceItem_hospitalId_name_key" ON "ServiceItem"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_hospitalId_id_key" ON "SlaPolicy"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_hospitalId_name_key" ON "SlaPolicy"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicyVersion_hospitalId_id_key" ON "SlaPolicyVersion"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicyVersion_hospitalId_slaPolicyId_version_key" ON "SlaPolicyVersion"("hospitalId", "slaPolicyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationPolicy_hospitalId_id_key" ON "EscalationPolicy"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationPolicy_hospitalId_name_key" ON "EscalationPolicy"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "EscalationLevel_hospitalId_roleId_idx" ON "EscalationLevel"("hospitalId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "EscalationLevel_hospitalId_escalationPolicyId_level_key" ON "EscalationLevel"("hospitalId", "escalationPolicyId", "level");

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_hospitalId_categoryId_fkey" FOREIGN KEY ("hospitalId", "categoryId") REFERENCES "ServiceCategory"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_hospitalId_departmentId_fkey" FOREIGN KEY ("hospitalId", "departmentId") REFERENCES "Department"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_hospitalId_slaPolicyId_fkey" FOREIGN KEY ("hospitalId", "slaPolicyId") REFERENCES "SlaPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_hospitalId_escalationPolicyId_fkey" FOREIGN KEY ("hospitalId", "escalationPolicyId") REFERENCES "EscalationPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPolicyVersion" ADD CONSTRAINT "SlaPolicyVersion_hospitalId_slaPolicyId_fkey" FOREIGN KEY ("hospitalId", "slaPolicyId") REFERENCES "SlaPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EscalationPolicy" ADD CONSTRAINT "EscalationPolicy_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationLevel" ADD CONSTRAINT "EscalationLevel_hospitalId_escalationPolicyId_fkey" FOREIGN KEY ("hospitalId", "escalationPolicyId") REFERENCES "EscalationPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "EscalationLevel" ADD CONSTRAINT "EscalationLevel_hospitalId_roleId_fkey" FOREIGN KEY ("hospitalId", "roleId") REFERENCES "Role"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;


-- SLA timings: both targets are measured from submission.
ALTER TABLE "SlaPolicyVersion" ADD CONSTRAINT "SlaPolicyVersion_minutes_check" CHECK (
  "acceptMinutes" BETWEEN 1 AND 1440 AND
  "completeMinutes" BETWEEN 1 AND 10080 AND
  "completeMinutes" >= "acceptMinutes"
);
ALTER TABLE "SlaPolicyVersion" ADD CONSTRAINT "SlaPolicyVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "SlaPolicy" ADD CONSTRAINT "SlaPolicy_currentVersion_check" CHECK ("currentVersion" >= 1);

-- SLA versions are immutable so a request's snapshot can never drift.
CREATE FUNCTION "reject_sla_policy_version_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SlaPolicyVersion rows are immutable; create a new version instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SlaPolicyVersion_immutable"
  BEFORE UPDATE ON "SlaPolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION "reject_sla_policy_version_update"();

-- Escalation levels: a ROLE target names a role; an ASSIGNEE target does not.
ALTER TABLE "EscalationLevel" ADD CONSTRAINT "EscalationLevel_target_check" CHECK (
  ("targetType" = 'ROLE' AND "roleId" IS NOT NULL) OR
  ("targetType" = 'ASSIGNEE' AND "roleId" IS NULL)
);
ALTER TABLE "EscalationLevel" ADD CONSTRAINT "EscalationLevel_values_check" CHECK (
  "level" BETWEEN 1 AND 10 AND "afterMinutes" BETWEEN 0 AND 1440
);

ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_sortOrder_check" CHECK ("sortOrder" BETWEEN 0 AND 1000);
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_sortOrder_check" CHECK ("sortOrder" BETWEEN 0 AND 1000);
