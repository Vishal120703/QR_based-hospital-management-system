import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, staffApi, type RequestAlert, type RequestAlerts } from '../api';

// Alerts for new, overdue, and escalated requests while a staff member is
// signed in. The server decides what each person should hear about; this
// polls it, and for each alert not seen before plays a short sound (if
// turned on) and shows a desktop notification (if the browser allows). The
// first answer after signing in only sets what counts as "seen", so opening
// the app does not ring for work that was already waiting. Alerts help but are
// never needed: the Requests screen shows the same work.

const pollMs = 30_000;
const soundKey = 'careqr.alertSound';
const seenKey = (membershipId: string) => `careqr.seenAlerts.${membershipId}`;

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; alerts still work for this visit.
  }
}

export const alertSound = {
  enabled: () => readStorage(soundKey) !== 'off',
  set: (on: boolean) => writeStorage(soundKey, on ? 'on' : 'off'),
};

// The browser's desktop notification permission, or 'unsupported'.
export function desktopAlertPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

// Asked only when the person presses the button, never on its own.
export async function askForDesktopAlerts(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

// The alerts not in `seen`, in the order the server sent them.
export function unseenAlerts(alerts: readonly RequestAlert[], seen: ReadonlySet<string>) {
  return alerts.filter((alert) => !seen.has(alert.key));
}

export function describeAlert(alert: RequestAlert): string {
  const what = `${alert.serviceName} · ${alert.bed}`;
  if (alert.kind === 'new') return `New request: ${what}`;
  if (alert.kind === 'overdue') {
    return `Overdue (${alert.deadline === 'accept' ? 'not accepted' : 'not completed'}): ${what}`;
  }
  return `Escalated (level ${alert.level ?? 1}): ${what}`;
}

// A short two-tone chime. Browsers allow sound only after the person has
// interacted with the page, so the audio is prepared on the first click or
// key press; until then (or if audio is unavailable) alerts are silent.
let audio: AudioContext | null = null;
function prepareAudio() {
  if (audio || typeof AudioContext === 'undefined') return;
  try {
    audio = new AudioContext();
  } catch {
    audio = null;
  }
}
export function playChime(): void {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  for (const [offset, frequency] of [
    [0, 880],
    [0.18, 660],
  ] as const) {
    const tone = audio.createOscillator();
    const volume = audio.createGain();
    tone.frequency.value = frequency;
    volume.gain.setValueAtTime(0.0001, start + offset);
    volume.gain.exponentialRampToValueAtTime(0.2, start + offset + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.16);
    tone.connect(volume).connect(audio.destination);
    tone.start(start + offset);
    tone.stop(start + offset + 0.18);
  }
}

export function useRequestAlerts(options: {
  token: string;
  membershipId: string;
  enabled: boolean;
  onUnauthorized: (cause: unknown) => void;
}): { data: RequestAlerts | null; announcement: string } {
  const { token, membershipId, enabled, onUnauthorized } = options;
  const [data, setData] = useState<RequestAlerts | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const unlock = () => {
      prepareAudio();
      void audio?.resume().catch(() => undefined);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Takes in one answer from the server: alert for what is new since last time.
  const apply = useCallback(
    (loaded: RequestAlerts) => {
      setData(loaded);
      const known = seen.current;
      const keys = loaded.alerts.map((alert) => alert.key);
      if (!known) {
        // First answer: only remember what is already there.
        const stored = JSON.parse(readStorage(seenKey(membershipId)) ?? '[]') as string[];
        seen.current = new Set([...stored, ...keys]);
      } else {
        const fresh = unseenAlerts(loaded.alerts, known);
        if (fresh.length > 0) {
          setAnnouncement(fresh.map(describeAlert).join('. '));
          if (alertSound.enabled()) playChime();
          if (desktopAlertPermission() === 'granted') {
            for (const alert of fresh.slice(0, 3)) {
              try {
                new Notification('CARE QR', { body: describeAlert(alert), tag: alert.key });
              } catch {
                // Some browsers allow notifications only from a service worker.
              }
            }
          }
          for (const key of keys) known.add(key);
        }
      }
      // Remember recent keys across reloads, without growing forever.
      writeStorage(seenKey(membershipId), JSON.stringify([...(seen.current ?? [])].slice(-500)));
    },
    [membershipId],
  );

  const check = useCallback(
    () =>
      staffApi.requestAlerts(token).then(apply, (cause: unknown) => {
        // Alerts are extra: a failed check waits for the next one.
        if (cause instanceof ApiError && cause.status === 401) onUnauthorized(cause);
      }),
    [token, apply, onUnauthorized],
  );

  useEffect(() => {
    if (!enabled) return;
    seen.current = null;
    void check();
    // Keeps checking in a background tab too, where alerts matter most.
    const timer = window.setInterval(() => void check(), pollMs);
    return () => window.clearInterval(timer);
  }, [enabled, check]);

  return { data: enabled ? data : null, announcement };
}
