-- Per-hospital logo for SaaS branding (staff app, patient page, QR labels).

-- CreateTable
CREATE TABLE "HospitalLogo" (
    "hospitalId" UUID NOT NULL,
    "publicId" UUID NOT NULL,
    "contentType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HospitalLogo_pkey" PRIMARY KEY ("hospitalId")
);

-- CreateIndex
CREATE UNIQUE INDEX "HospitalLogo_publicId_key" ON "HospitalLogo"("publicId");

-- AddForeignKey
ALTER TABLE "HospitalLogo" ADD CONSTRAINT "HospitalLogo_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only raster images the browser renders without running code (no SVG), up to
-- 1 MB, with the recorded size matching the stored bytes.
ALTER TABLE "HospitalLogo" ADD CONSTRAINT "HospitalLogo_image_rules" CHECK (
    "contentType" IN ('image/png', 'image/jpeg', 'image/webp')
    AND "byteSize" BETWEEN 1 AND 1048576
    AND octet_length("data") = "byteSize"
);
