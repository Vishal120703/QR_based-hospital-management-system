CREATE TYPE "RequestStatus" AS ENUM ('SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED');
CREATE TYPE "AssignmentMode" AS ENUM ('MANUAL', 'POOL', 'DIRECT', 'AUTO_ASSIGN');
CREATE TYPE "RequestActorType" AS ENUM ('GUEST', 'STAFF', 'SYSTEM');
CREATE TYPE "RequestEventType" AS ENUM ('SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'STARTED', 'COMPLETED', 'CLOSED', 'CANCELLED', 'REJECTED', 'TRANSFERRED');

CREATE TABLE "ServiceRequest" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "hospitalId" UUID NOT NULL,
    "bedId" UUID NOT NULL,
    "bedSessionId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "serviceName" TEXT NOT NULL,
    "categoryName" TEXT NOT NULL,
    "departmentId" UUID NOT NULL,
    "assigneeId" UUID,
    "priority" "RequestPriority" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'MANUAL',
    "routingRuleId" UUID,
    "slaPolicyId" UUID NOT NULL,
    "slaPolicyVersionId" UUID NOT NULL,
    "slaPolicyVersion" INTEGER NOT NULL,
    "acceptMinutes" INTEGER NOT NULL,
    "completeMinutes" INTEGER NOT NULL,
    "escalationPolicyId" UUID,
    "isEscalated" BOOLEAN NOT NULL DEFAULT false,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "acceptDueAt" TIMESTAMP(3) NOT NULL,
    "completeDueAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "ServiceRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ServiceRequest_version_check" CHECK ("version" > 0),
    CONSTRAINT "ServiceRequest_sla_check" CHECK ("acceptMinutes" >= 0 AND "completeMinutes" >= "acceptMinutes" AND "acceptDueAt" <= "completeDueAt"),
    CONSTRAINT "ServiceRequest_assignment_check" CHECK (("status" = 'SUBMITTED' AND "assigneeId" IS NULL) OR ("status" IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'REJECTED') AND "assigneeId" IS NOT NULL) OR ("status" = 'CANCELLED'))
);

CREATE TABLE "RequestEvent" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "type" "RequestEventType" NOT NULL,
    "previousStatus" "RequestStatus",
    "resultingStatus" "RequestStatus" NOT NULL,
    "actorType" "RequestActorType" NOT NULL,
    "actorId" UUID,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "requestVersion" INTEGER NOT NULL,
    "correlationId" TEXT,
    CONSTRAINT "RequestEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RequestEvent_version_check" CHECK ("requestVersion" > 0)
);

CREATE UNIQUE INDEX "ServiceRequest_publicId_key" ON "ServiceRequest"("publicId");
CREATE UNIQUE INDEX "ServiceRequest_hospitalId_id_key" ON "ServiceRequest"("hospitalId", "id");
CREATE INDEX "ServiceRequest_hospitalId_status_submittedAt_idx" ON "ServiceRequest"("hospitalId", "status", "submittedAt");
CREATE INDEX "ServiceRequest_hospitalId_bedSessionId_submittedAt_idx" ON "ServiceRequest"("hospitalId", "bedSessionId", "submittedAt");
CREATE INDEX "ServiceRequest_hospitalId_assigneeId_status_idx" ON "ServiceRequest"("hospitalId", "assigneeId", "status");
-- A single active request per service in an occupancy period. A completed
-- request can be submitted again even before its final close command.
CREATE UNIQUE INDEX "ServiceRequest_one_active_service_per_bed_session" ON "ServiceRequest"("hospitalId", "bedSessionId", "serviceId")
    WHERE "status" IN ('SUBMITTED', 'ASSIGNED', 'ACCEPTED', 'IN_PROGRESS');
CREATE UNIQUE INDEX "RequestEvent_hospitalId_requestId_requestVersion_key" ON "RequestEvent"("hospitalId", "requestId", "requestVersion");
CREATE INDEX "RequestEvent_hospitalId_requestId_occurredAt_idx" ON "RequestEvent"("hospitalId", "requestId", "occurredAt");

ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_bedId_fkey" FOREIGN KEY ("hospitalId", "bedId") REFERENCES "Bed"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_bedId_bedSessionId_fkey" FOREIGN KEY ("hospitalId", "bedId", "bedSessionId") REFERENCES "BedSession"("hospitalId", "bedId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_serviceId_fkey" FOREIGN KEY ("hospitalId", "serviceId") REFERENCES "ServiceItem"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_departmentId_fkey" FOREIGN KEY ("hospitalId", "departmentId") REFERENCES "Department"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_assigneeId_fkey" FOREIGN KEY ("hospitalId", "assigneeId") REFERENCES "HospitalMembership"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_slaPolicyId_fkey" FOREIGN KEY ("hospitalId", "slaPolicyId") REFERENCES "SlaPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_slaPolicyVersionId_fkey" FOREIGN KEY ("hospitalId", "slaPolicyVersionId") REFERENCES "SlaPolicyVersion"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "ServiceRequest" ADD CONSTRAINT "ServiceRequest_hospitalId_escalationPolicyId_fkey" FOREIGN KEY ("hospitalId", "escalationPolicyId") REFERENCES "EscalationPolicy"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "RequestEvent" ADD CONSTRAINT "RequestEvent_hospitalId_requestId_fkey" FOREIGN KEY ("hospitalId", "requestId") REFERENCES "ServiceRequest"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- History can only grow. Corrections are additional events, never edits.
CREATE FUNCTION "reject_request_event_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'RequestEvent is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RequestEvent_append_only" BEFORE UPDATE OR DELETE ON "RequestEvent"
    FOR EACH ROW EXECUTE FUNCTION "reject_request_event_mutation"();

INSERT INTO "Permission" ("key", "description") VALUES
    ('request.close', 'Close completed service requests'),
    ('request.reject', 'Reject assigned service requests')
ON CONFLICT ("key") DO UPDATE SET "description" = EXCLUDED."description";
INSERT INTO "RolePermission" ("id", "hospitalId", "roleId", "permissionKey")
SELECT gen_random_uuid(), r."hospitalId", r."id", p."key"
FROM "Role" r CROSS JOIN "Permission" p
WHERE r."name" = 'Hospital Admin' AND p."key" IN ('request.close', 'request.reject')
ON CONFLICT ("hospitalId", "roleId", "permissionKey") DO NOTHING;
