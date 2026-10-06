import { useState } from 'react';
import { assetUrl } from '../../api';

export const commonTimezones = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Dhaka',
  'Asia/Kathmandu',
  'Asia/Colombo',
  'Europe/London',
  'America/New_York',
  'UTC',
];

export function allTimezones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...commonTimezones, ...supported])];
}

// A strong temporary password for a new manager, to be shared privately.
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

// A short code staff can type at sign-in: the first meaningful word of the
// name, for example "Sunrise Multispeciality Hospital" -> "SUNRISE".
export function codeFromName(name: string): string {
  const generic = /^(THE|HOSPITAL|HOSPITALS|CLINIC|MEDICAL|CENTRE|CENTER|AND|OF)$/;
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word && !generic.test(word));
  return (words[0] ?? '').slice(0, 16);
}

export function HospitalMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return logoUrl ? (
    <img className="hospital-mark" src={assetUrl(logoUrl)} alt="" />
  ) : (
    <span className="hospital-mark initials" aria-hidden="true">
      {name
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase()}
    </span>
  );
}

export function PasswordField({
  value,
  onChange,
  label = 'Temporary password',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="wide-field">
      {label}
      <span className="password-row">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          required
          minLength={12}
          autoComplete="new-password"
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" className="secondary compact" onClick={() => setShow((on) => !on)}>
          {show ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          className="secondary compact"
          onClick={() => {
            onChange(generatePassword());
            setShow(true);
          }}
        >
          Generate
        </button>
      </span>
      <small className="muted">
        At least 12 characters. Share it privately with the manager, never by public chat.
      </small>
    </label>
  );
}
