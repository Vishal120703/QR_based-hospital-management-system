import { call } from './client';
import { type GuestLocation, type PublicCategory, type PublicRequest } from './types';

export const guestApi = {
  resolve: (qrToken: string) =>
    call<{ guestToken: string; expiresAt: string; location: GuestLocation }>(
      'POST',
      '/public/qr/resolve',
      null,
      { token: qrToken },
    ),
  session: (guestToken: string) =>
    call<{ location: GuestLocation }>('GET', '/public/session', guestToken),
  services: async (guestToken: string) =>
    (await call<{ categories: PublicCategory[] }>('GET', '/public/services', guestToken))
      .categories,
  requests: async (guestToken: string) =>
    (await call<{ serviceRequests: PublicRequest[] }>('GET', '/public/requests', guestToken))
      .serviceRequests,
  submitRequest: async (guestToken: string, serviceId: string) =>
    (
      await call<{ serviceRequest: PublicRequest }>('POST', '/public/requests', guestToken, {
        serviceId,
      })
    ).serviceRequest,
  cancelRequest: async (guestToken: string, publicId: string, reason: string) =>
    (
      await call<{ serviceRequest: PublicRequest }>(
        'POST',
        `/public/requests/${encodeURIComponent(publicId)}/cancel`,
        guestToken,
        { reason },
      )
    ).serviceRequest,
};
