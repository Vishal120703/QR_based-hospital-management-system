-- Escalation steps the SLA worker takes after a missed accept or complete
-- deadline. The unique key makes each step happen once, even when several API
-- processes run the worker at the same time or it restarts.

-- CreateEnum
CREATE TYPE "EscalationStage" AS ENUM ('ACCEPT', 'COMPLETE');

-- CreateTable
CREATE TABLE "RequestEscalation" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "stage" "EscalationStage" NOT NULL,
    "level" INTEGER NOT NULL,
    "targetType" "EscalationTarget" NOT NULL,
    "roleId" UUID,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestEscalation_hospitalId_createdAt_idx" ON "RequestEscalation"("hospitalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequestEscalation_hospitalId_requestId_stage_level_key" ON "RequestEscalation"("hospitalId", "requestId", "stage", "level");

-- AddForeignKey
ALTER TABLE "RequestEscalation" ADD CONSTRAINT "RequestEscalation_hospitalId_requestId_fkey" FOREIGN KEY ("hospitalId", "requestId") REFERENCES "ServiceRequest"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

