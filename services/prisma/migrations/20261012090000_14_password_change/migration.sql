-- After an administrator resets a staff password, the person must choose a
-- new one before using the app.
ALTER TABLE "User" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
