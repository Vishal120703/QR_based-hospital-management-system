import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { credentials, guestApi } from '../src/api';
import { QrEntryPage, tokenFromQrLink } from '../src/features/patient/QrEntryPage';

const token = 'A'.repeat(43);
const camera = vi.hoisted(() => ({ decode: vi.fn(), image: vi.fn(), stop: vi.fn() }));

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints(...args: unknown[]) {
      return camera.decode(...args) as Promise<{ stop: () => void }>;
    }

    decodeFromImageUrl(...args: unknown[]) {
      return camera.image(...args) as Promise<{ getText: () => string }>;
    }
  },
}));

function renderEntry() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<QrEntryPage />} />
        <Route path="/login" element={<p>Staff login page</p>} />
        <Route path="/patient" element={<p>Patient request page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Patient QR entry', () => {
  it('accepts only this site’s bedside QR link', () => {
    expect(tokenFromQrLink(`/q/${token}`, 'http://localhost:5173')).toBe(token);
    expect(tokenFromQrLink(`http://localhost:5173/q/${token}`, 'http://localhost:5173')).toBe(
      token,
    );
    expect(tokenFromQrLink(`https://other.example/q/${token}`, 'http://localhost:5173')).toBeNull();
    expect(tokenFromQrLink(`/q/${token}?next=evil`, 'http://localhost:5173')).toBeNull();
    expect(tokenFromQrLink('/q/short', 'http://localhost:5173')).toBeNull();
  });

  it('opens on patient scanning and offers a separate staff path', async () => {
    const user = userEvent.setup();
    renderEntry();
    expect(screen.getByRole('heading', { name: 'Scan your bedside QR' })).toBeTruthy();
    expect(screen.queryByText('Camera preview appears here')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Staff sign in' }));
    expect(screen.getByText('Staff login page')).toBeTruthy();
  });

  it('exchanges a pasted QR link for guest access without a patient login', async () => {
    const user = userEvent.setup();
    const resolve = vi.spyOn(guestApi, 'resolve').mockResolvedValue({
      guestToken: 'guest-session',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      location: {
        hospitalName: 'Test Hospital',
        hospitalLogoUrl: null,
        bed: { code: '101', displayName: 'Bed 101' },
        room: null,
        ward: 'General',
        floor: 'First floor',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    renderEntry();

    await user.type(screen.getByLabelText('Paste the bedside QR link'), `/q/${token}`);
    await user.click(screen.getByRole('button', { name: 'Open patient page' }));

    expect(await screen.findByText('Patient request page')).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith(token);
    expect(credentials.guest()).toBe('guest-session');
  });

  it('rejects an unrelated QR before contacting the backend', async () => {
    const user = userEvent.setup();
    const resolve = vi.spyOn(guestApi, 'resolve');
    renderEntry();

    await user.type(
      screen.getByLabelText('Paste the bedside QR link'),
      `https://other.example/q/${token}`,
    );
    await user.click(screen.getByRole('button', { name: 'Open patient page' }));

    expect(await screen.findByText(/not a CARE QR link for this website/)).toBeTruthy();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('reads a QR photo locally and opens the patient page', async () => {
    const user = userEvent.setup();
    const previousCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const previousRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:local-photo'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    camera.image.mockResolvedValue({ getText: () => `/q/${token}` });
    const resolve = vi.spyOn(guestApi, 'resolve').mockResolvedValue({
      guestToken: 'photo-guest',
      expiresAt: '',
      location: {
        hospitalName: 'Test Hospital',
        hospitalLogoUrl: null,
        bed: { code: '101', displayName: 'Bed 101' },
        room: null,
        ward: 'General',
        floor: 'First floor',
        expiresAt: '',
      },
    });
    try {
      renderEntry();
      await user.upload(
        screen.getByLabelText(/Upload a QR photo/),
        new File(['qr-image'], 'bedside.png', { type: 'image/png' }),
      );
      expect(await screen.findByText('Patient request page')).toBeTruthy();
      expect(camera.image).toHaveBeenCalledWith('blob:local-photo');
      expect(resolve).toHaveBeenCalledWith(token);
      expect(revoke).toHaveBeenCalledWith('blob:local-photo');
    } finally {
      if (previousCreate) Object.defineProperty(URL, 'createObjectURL', previousCreate);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (previousRevoke) Object.defineProperty(URL, 'revokeObjectURL', previousRevoke);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it('scans from the camera and stops it before opening patient access', async () => {
    const user = userEvent.setup();
    let emit:
      | ((
          result: { getText: () => string },
          error: undefined,
          controls: { stop: () => void },
        ) => void)
      | undefined;
    camera.decode.mockImplementation(
      (_constraints: unknown, _video: unknown, callback: typeof emit) => {
        emit = callback;
        return Promise.resolve({ stop: camera.stop });
      },
    );
    const previousMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    vi.spyOn(guestApi, 'resolve').mockResolvedValue({
      guestToken: 'camera-guest',
      expiresAt: '',
      location: {
        hospitalName: 'Test Hospital',
        hospitalLogoUrl: null,
        bed: { code: '101', displayName: 'Bed 101' },
        room: null,
        ward: 'General',
        floor: 'First floor',
        expiresAt: '',
      },
    });
    try {
      renderEntry();
      await user.click(screen.getByRole('button', { name: 'Start camera' }));
      expect(await screen.findByRole('button', { name: 'Stop camera' })).toBeTruthy();
      await act(async () => {
        emit?.({ getText: () => `/q/${token}` }, undefined, { stop: camera.stop });
        await Promise.resolve();
      });
      expect(await screen.findByText('Patient request page')).toBeTruthy();
      expect(camera.stop).toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: previousMediaDevices,
      });
    }
  });
});
