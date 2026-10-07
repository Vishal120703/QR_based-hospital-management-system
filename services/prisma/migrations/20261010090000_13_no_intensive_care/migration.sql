-- Intensive care is not served by bedside QR: remove the ICU, HDU, CCU, NICU,
-- and PICU unit types and the ICU, ventilator, and incubator bed types.
-- Any existing unit or bed of those types becomes "Other" first, so no row is
-- lost; its name and history are unchanged and a manager can retype it.
BEGIN;

UPDATE "Ward" SET "unitType" = 'OTHER'
WHERE "unitType" IN ('ICU', 'HDU', 'CCU', 'NICU', 'PICU');

UPDATE "Bed" SET "bedType" = 'OTHER'
WHERE "bedType" IN ('ICU', 'VENTILATOR', 'NEONATAL');

CREATE TYPE "BedType_new" AS ENUM ('STANDARD', 'ISOLATION', 'PEDIATRIC_COT', 'DAY_CARE_CHAIR', 'DIALYSIS_CHAIR', 'EMERGENCY_TROLLEY', 'LABOUR', 'OTHER');
ALTER TABLE "Bed" ALTER COLUMN "bedType" DROP DEFAULT;
ALTER TABLE "Bed" ALTER COLUMN "bedType" TYPE "BedType_new" USING ("bedType"::text::"BedType_new");
ALTER TYPE "BedType" RENAME TO "BedType_old";
ALTER TYPE "BedType_new" RENAME TO "BedType";
DROP TYPE "BedType_old";
ALTER TABLE "Bed" ALTER COLUMN "bedType" SET DEFAULT 'STANDARD';

CREATE TYPE "WardType_new" AS ENUM ('GENERAL', 'PRIVATE', 'SEMI_PRIVATE', 'EMERGENCY', 'DAY_CARE', 'MATERNITY', 'LABOUR_ROOM', 'PEDIATRIC', 'ISOLATION', 'BURNS', 'DIALYSIS', 'RECOVERY', 'PSYCHIATRY', 'OTHER');
ALTER TABLE "Ward" ALTER COLUMN "unitType" DROP DEFAULT;
ALTER TABLE "Ward" ALTER COLUMN "unitType" TYPE "WardType_new" USING ("unitType"::text::"WardType_new");
ALTER TYPE "WardType" RENAME TO "WardType_old";
ALTER TYPE "WardType_new" RENAME TO "WardType";
DROP TYPE "WardType_old";
ALTER TABLE "Ward" ALTER COLUMN "unitType" SET DEFAULT 'GENERAL';

COMMIT;
