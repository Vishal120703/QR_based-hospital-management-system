-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'INACTIVE', 'MAINTENANCE');

-- CreateTable
CREATE TABLE "Building" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Floor" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "buildingId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Floor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "floorId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "wardId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bed" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "wardId" UUID NOT NULL,
    "roomId" UUID,
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Building_hospitalId_id_key" ON "Building"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Building_hospitalId_code_key" ON "Building"("hospitalId", "code");

-- CreateIndex
CREATE INDEX "Floor_hospitalId_buildingId_idx" ON "Floor"("hospitalId", "buildingId");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_hospitalId_id_key" ON "Floor"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Floor_hospitalId_code_key" ON "Floor"("hospitalId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Ward_hospitalId_id_key" ON "Ward"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Ward_hospitalId_floorId_code_key" ON "Ward"("hospitalId", "floorId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hospitalId_id_key" ON "Room"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hospitalId_wardId_id_key" ON "Room"("hospitalId", "wardId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hospitalId_wardId_code_key" ON "Room"("hospitalId", "wardId", "code");

-- CreateIndex
CREATE INDEX "Bed_hospitalId_roomId_idx" ON "Bed"("hospitalId", "roomId");

-- CreateIndex
CREATE UNIQUE INDEX "Bed_hospitalId_id_key" ON "Bed"("hospitalId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bed_hospitalId_wardId_code_key" ON "Bed"("hospitalId", "wardId", "code");

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_hospitalId_buildingId_fkey" FOREIGN KEY ("hospitalId", "buildingId") REFERENCES "Building"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_hospitalId_floorId_fkey" FOREIGN KEY ("hospitalId", "floorId") REFERENCES "Floor"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hospitalId_wardId_fkey" FOREIGN KEY ("hospitalId", "wardId") REFERENCES "Ward"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_hospitalId_wardId_fkey" FOREIGN KEY ("hospitalId", "wardId") REFERENCES "Ward"("hospitalId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Bed" ADD CONSTRAINT "Bed_hospitalId_wardId_roomId_fkey" FOREIGN KEY ("hospitalId", "wardId", "roomId") REFERENCES "Room"("hospitalId", "wardId", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

