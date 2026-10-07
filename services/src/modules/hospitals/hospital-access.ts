import { type ClientStatus, type HospitalStatus } from '@prisma/client';

// A hospital is open to its staff and patients only while both the hospital
// and the client that owns it are active. Select these fields wherever
// access is checked.
export const hospitalAccessSelect = {
  status: true,
  client: { select: { status: true } },
} as const;

export function hospitalIsOpen(hospital: {
  readonly status: HospitalStatus;
  readonly client: { readonly status: ClientStatus };
}): boolean {
  return hospital.status === 'ACTIVE' && hospital.client.status === 'ACTIVE';
}
