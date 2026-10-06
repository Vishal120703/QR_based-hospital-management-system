-- Location types and per-building floor codes, so the layout fits campuses
-- with several buildings and specialty units (ICU, NICU, emergency, day care).

-- CreateEnum
CREATE TYPE "WardType" AS ENUM ('GENERAL', 'PRIVATE', 'SEMI_PRIVATE', 'ICU', 'HDU', 'CCU', 'NICU', 'PICU', 'EMERGENCY', 'DAY_CARE', 'MATERNITY', 'LABOUR_ROOM', 'PEDIATRIC', 'ISOLATION', 'BURNS', 'DIALYSIS', 'RECOVERY', 'PSYCHIATRY', 'OTHER');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('GENERAL', 'PRIVATE', 'SEMI_PRIVATE', 'DELUXE', 'SUITE', 'ISOLATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BedType" AS ENUM ('STANDARD', 'ICU', 'VENTILATOR', 'ISOLATION', 'PEDIATRIC_COT', 'NEONATAL', 'DAY_CARE_CHAIR', 'DIALYSIS_CHAIR', 'EMERGENCY_TROLLEY', 'LABOUR', 'OTHER');

-- AlterTable
ALTER TABLE "Floor" ADD COLUMN     "level" INTEGER;
ALTER TABLE "Floor" ADD CONSTRAINT "Floor_level_range" CHECK ("level" IS NULL OR "level" BETWEEN -10 AND 200);

-- AlterTable
ALTER TABLE "Ward" ADD COLUMN     "unitType" "WardType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "roomType" "RoomType" NOT NULL DEFAULT 'GENERAL';

-- AlterTable
ALTER TABLE "Bed" ADD COLUMN     "bedType" "BedType" NOT NULL DEFAULT 'STANDARD';

-- Floor codes were unique per hospital, which blocked "G" in two buildings.
-- They are now unique per building, and among floors with no building.
DROP INDEX "Floor_hospitalId_code_key";
CREATE UNIQUE INDEX "Floor_hospitalId_buildingId_code_key"
    ON "Floor"("hospitalId", "buildingId", "code") WHERE "buildingId" IS NOT NULL;
CREATE UNIQUE INDEX "Floor_hospitalId_code_unassigned_key"
    ON "Floor"("hospitalId", "code") WHERE "buildingId" IS NULL;
