import { describe, expect, it, vi } from 'vitest';
import { ApiError, credentials, guestApi, staffApi } from '../src/api';

describe('API recovery', () => {
  it('provides an actionable network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(staffApi.me('token')).rejects.toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
    });
    await expect(staffApi.me('token')).rejects.toThrow('Check your connection');
  });
  it('handles malformed error responses without a TypeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: null }), { status: 502 })),
    );
    await expect(staffApi.me('token')).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects an unreadable successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON', { status: 200 })));
    await expect(staffApi.me('token')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('keeps credentials in memory when private-mode storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage blocked');
    });
    credentials.setStaff('private-token');
    expect(credentials.staff()).toBe('private-token');
    credentials.setStaff(null);
    expect(credentials.staff()).toBe(null);
  });

  it('uses the guest token and public request contract for list, submit, and cancel', async () => {
    const request = {
      publicId: 'CR-12345678',
      serviceId: 'service-1',
      serviceName: 'Drinking water',
      status: 'SUBMITTED',
      submittedAt: '2026-10-06T10:00:00.000Z',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ serviceRequests: [request] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ serviceRequest: request }), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ serviceRequest: { ...request, status: 'CANCELLED' } })),
      );
    vi.stubGlobal('fetch', fetchMock);

    expect(await guestApi.requests('guest-token')).toEqual([request]);
    expect(await guestApi.submitRequest('guest-token', 'service-1')).toEqual(request);
    expect(
      await guestApi.cancelRequest('guest-token', request.publicId, 'No longer needed'),
    ).toMatchObject({
      status: 'CANCELLED',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/public/requests',
      expect.objectContaining({ method: 'GET', headers: { authorization: 'Bearer guest-token' } }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/public/requests',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ serviceId: 'service-1' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/public/requests/CR-12345678/cancel',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'No longer needed' }),
      }),
    );
  });
});
