-- The hospital manager's Settings: pause patient requests, pause escalations,
-- turn off kinds of staff notification, and choose the patient page languages.
-- Existing hospitals keep today's behaviour (nothing paused, every
-- notification on, English and Hindi).
ALTER TABLE "Hospital" ADD COLUMN "patientRequestsPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "escalationsPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mutedNotificationTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "patientLanguages" TEXT[] DEFAULT ARRAY['en', 'hi']::TEXT[];
