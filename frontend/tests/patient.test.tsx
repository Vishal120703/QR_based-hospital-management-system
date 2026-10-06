import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  credentials,
  guestApi,
  type GuestLocation,
  type PublicCategory,
  type PublicRequest,
} from '../src/api';
import { PatientPage } from '../src/pages/PatientPage';
import { ScanPage } from '../src/pages/ScanPage';
import { LoginPage } from '../src/pages/LoginPage';

const location: GuestLocation = {
  hospitalName: 'Test Hospital',
  bed: { code: '101', displayName: 'Bed 101' },
  room: null,
  ward: 'General',
  floor: 'First floor',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

const categories: PublicCategory[] = [
  {
    id: 'category-1',
    name: 'Room support',
    description: null,
    emergencyNotice: false,
    services: [{ id: 'service-1', name: 'Drinking water', description: 'Bring fresh water.' }],
  },
];

const submittedRequest: PublicRequest = {
  publicId: 'CR-12345678',
  serviceId: 'service-1',
  serviceName: 'Drinking water',
  status: 'SUBMITTED',
  submittedAt: '2026-10-06T10:00:00.000Z',
};

function mockPatient(requests: PublicRequest[] = [], services = categories) {
  vi.spyOn(guestApi, 'session').mockResolvedValue({ location });
  vi.spyOn(guestApi, 'services').mockResolvedValue(services);
  vi.spyOn(guestApi, 'requests').mockResolvedValue(requests);
}

function renderPatient() {
  return render(
    <MemoryRouter>
      <PatientPage />
    </MemoryRouter>,
  );
}

describe('Patient request flow', () => {
  it('explains that patients enter through the bedside QR, not staff login', () => {
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );
    expect(screen.getByText('Patient or attendant?')).toBeTruthy();
    expect(screen.getByText(/Scan the QR code at your bed to request a service/)).toBeTruthy();

    renderPatient();
    expect(screen.getByText(/No patient account or staff login is needed/)).toBeTruthy();
  });

  it('retries transient errors without discarding the guest credential', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    vi.spyOn(guestApi, 'session')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Network unavailable'))
      .mockResolvedValue({ location });
    vi.spyOn(guestApi, 'services').mockResolvedValue([]);
    vi.spyOn(guestApi, 'requests').mockResolvedValue([]);
    renderPatient();
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Bed 101' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No services available yet' })).toBeTruthy();
    expect(credentials.guest()).toBe('guest-token');
    expect(screen.getByRole('heading', { name: 'Your requests' })).toBeTruthy();
    expect(screen.getByText(/No requests yet/)).toBeTruthy();
  });

  it('clears an invalid guest session and asks for a fresh scan', async () => {
    credentials.setGuest('expired-token');
    vi.spyOn(guestApi, 'session').mockRejectedValue(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid session'),
    );
    vi.spyOn(guestApi, 'services').mockResolvedValue([]);
    vi.spyOn(guestApi, 'requests').mockResolvedValue([]);
    renderPatient();
    expect(await screen.findByText(/Your session has ended/)).toBeTruthy();
    expect(credentials.guest()).toBeNull();
  });

  it('submits a service and switches the card to tracking the active request', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    mockPatient();
    const submit = vi.spyOn(guestApi, 'submitRequest').mockResolvedValue(submittedRequest);
    renderPatient();

    await user.click(await screen.findByRole('button', { name: 'Request service' }));

    expect(submit).toHaveBeenCalledWith('guest-token', 'service-1');
    expect(await screen.findByText('CR-12345678')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View request' }).getAttribute('href')).toBe(
      '#request-CR-12345678',
    );
    expect(screen.queryByRole('button', { name: 'Request service' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Submitted' })).toBeTruthy();
  });

  it('asks before cancellation and updates the status after confirmation', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    mockPatient([submittedRequest]);
    const cancel = vi
      .spyOn(guestApi, 'cancelRequest')
      .mockResolvedValue({ ...submittedRequest, status: 'CANCELLED' });
    renderPatient();

    await user.click(await screen.findByRole('button', { name: 'Cancel request' }));
    expect(cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Yes, cancel request' }));

    expect(cancel).toHaveBeenCalledWith('guest-token', 'CR-12345678', 'Cancelled by patient');
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Request service' })).toBeTruthy();
  });

  it('recovers from a duplicate conflict by refreshing the existing request', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    mockPatient();
    vi.spyOn(guestApi, 'requests').mockResolvedValueOnce([]).mockResolvedValue([submittedRequest]);
    vi.spyOn(guestApi, 'submitRequest').mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'Already requested'),
    );
    renderPatient();

    await user.click(await screen.findByRole('button', { name: 'Request service' }));

    expect(await screen.findByText('CR-12345678')).toBeTruthy();
    expect(screen.getByText(/active request for this service already exists/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View request' })).toBeTruthy();
  });

  it('refreshes tracking and removes cancellation when work has started', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    mockPatient([submittedRequest]);
    vi.spyOn(guestApi, 'requests')
      .mockResolvedValueOnce([submittedRequest])
      .mockResolvedValue([{ ...submittedRequest, status: 'IN_PROGRESS' }]);
    renderPatient();

    await user.click(await screen.findByRole('button', { name: 'Refresh status' }));

    expect(await screen.findByRole('list', { name: 'In progress' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).toBeNull();
  });

  it('switches the key patient controls and emergency guidance to Hindi', async () => {
    const user = userEvent.setup();
    credentials.setGuest('guest-token');
    mockPatient([submittedRequest]);
    renderPatient();

    await user.selectOptions(await screen.findByLabelText('Language'), 'hi');

    expect(screen.getByRole('heading', { name: 'आपके अनुरोध' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'अनुरोध रद्द करें' })).toBeTruthy();
    expect(screen.getByText('आपातकाल के लिए नहीं।')).toBeTruthy();
  });

  it('resolves the QR once in StrictMode and removes its permanent token from the route', async () => {
    const resolve = vi
      .spyOn(guestApi, 'resolve')
      .mockResolvedValue({ guestToken: 'new-guest', expiresAt: location.expiresAt, location });
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/q/opaque-token']}>
          <Routes>
            <Route path="/q/:token" element={<ScanPage />} />
            <Route path="/patient" element={<p>Connected patient page</p>} />
          </Routes>
        </MemoryRouter>
      </StrictMode>,
    );
    expect(await screen.findByText('Connected patient page')).toBeTruthy();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(credentials.guest()).toBe('new-guest');
  });

  it('distinguishes a network problem from an inactive QR and offers retry', async () => {
    const user = userEvent.setup();
    const resolve = vi
      .spyOn(guestApi, 'resolve')
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Cannot reach hospital'))
      .mockResolvedValue({ guestToken: 'guest', expiresAt: location.expiresAt, location });
    render(
      <MemoryRouter initialEntries={['/q/opaque-token']}>
        <Routes>
          <Route path="/q/:token" element={<ScanPage />} />
          <Route path="/patient" element={<p>Connected patient page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Cannot reach hospital')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Connected patient page')).toBeTruthy();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
