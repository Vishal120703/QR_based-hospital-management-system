import { call } from './client';

// SaaS platform administration (super admin), separate from hospital staff.
// A client is a customer organisation that owns one or more hospitals.
export type ClientStatus = 'ACTIVE' | 'SUSPENDED';
export interface PlatformClientRef {
  id: string;
  name: string;
  code: string;
  status: ClientStatus;
}
export interface PlatformClient extends PlatformClientRef {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  createdAt: string;
  hospitalCount: number;
  activeBeds: number;
  activeStaff: number;
  openRequests: number;
  hospitals?: PlatformHospital[];
}
export interface NewClientInput {
  name: string;
  code: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
}
export interface PlatformHospital {
  id: string;
  name: string;
  code: string;
  timezone: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  createdAt: string;
  logoUrl: string | null;
  client: PlatformClientRef;
  activeBeds?: number;
  activeStaff?: number;
  openRequests?: number;
  managers?: { membershipId: string; status: string; email: string; displayName: string }[];
}
export interface NewHospitalInput {
  name: string;
  code: string;
  timezone: string;
  managerName: string;
  managerEmail: string;
  managerPassword: string;
  // An existing client, or a new one; without both the hospital becomes its own client.
  clientId?: string;
  client?: NewClientInput;
}

export const platformApi = {
  login: (input: { email: string; password: string }) =>
    call<{ token: string; expiresAt: string }>('POST', '/auth/platform/login', null, input),
  me: (token: string) =>
    call<{ user: { id: string; email: string; displayName: string } }>(
      'GET',
      '/auth/platform/me',
      token,
    ),
  logout: (token: string) => call<null>('POST', '/auth/platform/logout', token),
  clients: async (token: string) =>
    (await call<{ clients: PlatformClient[] }>('GET', '/platform/clients', token)).clients,
  client: async (token: string, id: string) =>
    (await call<{ client: PlatformClient }>('GET', `/platform/clients/${id}`, token)).client,
  updateClient: async (
    token: string,
    id: string,
    input: {
      name?: string;
      contactName?: string | null;
      contactEmail?: string | null;
      contactPhone?: string | null;
      status?: ClientStatus;
    },
  ) =>
    (await call<{ client: PlatformClient }>('PATCH', `/platform/clients/${id}`, token, input))
      .client,
  hospitals: async (token: string) =>
    (await call<{ hospitals: PlatformHospital[] }>('GET', '/platform/hospitals', token)).hospitals,
  hospital: async (token: string, id: string) =>
    (await call<{ hospital: PlatformHospital }>('GET', `/platform/hospitals/${id}`, token))
      .hospital,
  createHospital: async (token: string, input: NewHospitalInput) =>
    (await call<{ hospital: PlatformHospital }>('POST', '/platform/hospitals', token, input))
      .hospital,
  updateHospital: async (
    token: string,
    id: string,
    input: { name?: string; timezone?: string; status?: 'ACTIVE' | 'SUSPENDED'; clientId?: string },
  ) =>
    (await call<{ hospital: PlatformHospital }>('PATCH', `/platform/hospitals/${id}`, token, input))
      .hospital,
  uploadLogo: (token: string, id: string, image: Blob) =>
    call<{ logoUrl: string }>('PUT', `/platform/hospitals/${id}/logo`, token, image),
  removeLogo: (token: string, id: string) =>
    call<null>('DELETE', `/platform/hospitals/${id}/logo`, token),
  addManager: async (
    token: string,
    id: string,
    input: { displayName: string; email: string; password: string },
  ) =>
    (
      await call<{ hospital: PlatformHospital }>(
        'POST',
        `/platform/hospitals/${id}/managers`,
        token,
        input,
      )
    ).hospital,
};
