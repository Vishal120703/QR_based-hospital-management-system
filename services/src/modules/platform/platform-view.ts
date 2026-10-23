interface HospitalTotals {
  readonly activeBeds: number;
  readonly activeStaff: number;
  readonly openRequests: number;
}

export function withClientTotals<T extends object>(
  client: T,
  hospitals: readonly HospitalTotals[],
) {
  const sum = (pick: (hospital: HospitalTotals) => number) =>
    hospitals.reduce((total, hospital) => total + pick(hospital), 0);
  return {
    ...client,
    hospitalCount: hospitals.length,
    activeBeds: sum((hospital) => hospital.activeBeds),
    activeStaff: sum((hospital) => hospital.activeStaff),
    openRequests: sum((hospital) => hospital.openRequests),
  };
}

export function countsByHospital(
  rows: readonly { readonly hospitalId: string; readonly _count: number }[],
): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.hospitalId, row._count]));
}

export function clientAuditSnapshot(client: {
  readonly name: string;
  readonly status: string;
  readonly contactName: string | null;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
}) {
  return {
    name: client.name,
    status: client.status,
    contactName: client.contactName,
    contactEmail: client.contactEmail,
    contactPhone: client.contactPhone,
  };
}

export function hospitalAuditSnapshot(hospital: {
  readonly name: string;
  readonly timezone: string;
  readonly status: string;
  readonly clientId: string;
}) {
  return {
    name: hospital.name,
    timezone: hospital.timezone,
    status: hospital.status,
    clientId: hospital.clientId,
  };
}
