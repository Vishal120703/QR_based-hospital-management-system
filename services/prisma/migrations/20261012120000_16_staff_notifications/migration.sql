CREATE TABLE "StaffNotification" (
  "id" UUID NOT NULL,
  "hospitalId" UUID NOT NULL,
  "membershipId" UUID NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "priority" "RequestPriority" NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "entityType" TEXT NOT NULL DEFAULT 'ServiceRequest',
  "entityId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  "realtimeAttemptedAt" TIMESTAMP(3),
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextDeliveryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaffNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StaffNotification_recipient_fkey" FOREIGN KEY ("hospitalId", "membershipId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "StaffNotification_hospitalId_membershipId_sourceKey_key" ON "StaffNotification"("hospitalId", "membershipId", "sourceKey");
CREATE INDEX "StaffNotification_hospitalId_membershipId_createdAt_id_idx" ON "StaffNotification"("hospitalId", "membershipId", "createdAt", "id");
CREATE INDEX "StaffNotification_hospitalId_membershipId_readAt_idx" ON "StaffNotification"("hospitalId", "membershipId", "readAt");
CREATE INDEX "StaffNotification_realtimeAttemptedAt_createdAt_idx" ON "StaffNotification"("realtimeAttemptedAt", "createdAt");
CREATE TABLE "NotificationDispatch" (
  "sourceKey" TEXT NOT NULL PRIMARY KEY,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recipients" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3)
);
-- Do not send old historical work as new alerts when rolling this feature out.
INSERT INTO "NotificationDispatch" ("sourceKey", "recipients", "outcome")
SELECT 'event:' || "id", 0, 'HISTORICAL_SKIP' FROM "RequestEvent";
INSERT INTO "NotificationDispatch" ("sourceKey", "recipients", "outcome")
SELECT 'escalation:' || "id", 0, 'HISTORICAL_SKIP' FROM "RequestEscalation";
