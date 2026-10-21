-- The hash remains the scan lookup. The encrypted token is returned only to
-- authorized hospital managers who reopen an active QR for printing.
-- Existing rows stay null because their original random token cannot be
-- reconstructed; replacing one stores a reprintable encrypted copy.
ALTER TABLE "BedQrCode" ADD COLUMN "tokenCiphertext" TEXT;
