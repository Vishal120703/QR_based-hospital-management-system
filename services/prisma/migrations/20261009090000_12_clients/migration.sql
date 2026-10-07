-- Clients: the customers of the CARE QR platform. A client (a hospital group
-- or a single hospital) owns one or more hospitals. Each existing hospital
-- becomes its own client, with the hospital's name and code.
CREATE TYPE "ClientStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Client_code_key" ON "Client"("code");

ALTER TABLE "Hospital" ADD COLUMN "clientId" UUID;

INSERT INTO "Client" ("id", "name", "code", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), h."name", h."code", 'ACTIVE', h."createdAt", CURRENT_TIMESTAMP
FROM "Hospital" h;

UPDATE "Hospital" h SET "clientId" = c."id" FROM "Client" c WHERE c."code" = h."code";

ALTER TABLE "Hospital" ALTER COLUMN "clientId" SET NOT NULL;
CREATE INDEX "Hospital_clientId_idx" ON "Hospital"("clientId");
ALTER TABLE "Hospital" ADD CONSTRAINT "Hospital_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
