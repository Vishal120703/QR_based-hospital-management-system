// What a hospital manager can turn on or off in Settings, apart from bed
// occupancy management (which has its own endpoint because switching it
// changes patients' stays). Each setting is enforced on the server.

// The kinds of staff inbox notification. A hospital can turn any of them off.
export const staffNotificationTypes = [
  'SUBMITTED',
  'ASSIGNED',
  'TRANSFERRED',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
  'ESCALATED',
] as const;
export type StaffNotificationType = (typeof staffNotificationTypes)[number];

// The languages of the patient page. English is always offered.
export const patientLanguages = ['en', 'hi'] as const;
export type PatientLanguage = (typeof patientLanguages)[number];

export interface HospitalSettings {
  readonly bedOccupancyEnabled: boolean;
  readonly patientRequestsPaused: boolean;
  readonly escalationsPaused: boolean;
  readonly mutedNotificationTypes: readonly string[];
  readonly patientLanguages: readonly string[];
}

export const hospitalSettingsSelect = {
  bedOccupancyEnabled: true,
  patientRequestsPaused: true,
  escalationsPaused: true,
  mutedNotificationTypes: true,
  patientLanguages: true,
} as const;

// The languages a patient may choose, in a fixed order, English first.
export function offeredLanguages(stored: readonly string[]): PatientLanguage[] {
  return patientLanguages.filter((language) => language === 'en' || stored.includes(language));
}
