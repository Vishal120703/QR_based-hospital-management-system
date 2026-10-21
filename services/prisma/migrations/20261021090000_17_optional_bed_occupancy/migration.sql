-- A hospital can turn bed occupancy management off and use bedside QR codes
-- without admitting patients. Existing hospitals keep admissions on.
ALTER TABLE "Hospital" ADD COLUMN "bedOccupancyEnabled" BOOLEAN NOT NULL DEFAULT true;

-- With it off, a patient's QR scan opens the bed's stay, so no staff member
-- started it.
ALTER TABLE "BedSession" ALTER COLUMN "startedByMembershipId" DROP NOT NULL;
