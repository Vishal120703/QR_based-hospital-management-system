import { Bell, BellOff, MonitorCheck } from 'lucide-react';
import { useState } from 'react';
import { alertSound, askForDesktopAlerts, desktopAlertPermission } from '../../lib/request-alerts';

// Sound on or off for new, overdue, and escalated requests, and desktop
// notifications, which the browser asks about only when this button is
// pressed (never on its own).
export function AlertSettings() {
  const [sound, setSound] = useState(alertSound.enabled());
  const [permission, setPermission] = useState(desktopAlertPermission());
  return (
    <div className="alert-settings" role="group" aria-label="Alerts">
      <button
        type="button"
        className="secondary icon-button"
        aria-pressed={sound}
        title="A short chime for new, overdue, or escalated requests"
        onClick={() => {
          alertSound.set(!sound);
          setSound(!sound);
        }}
      >
        {sound ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
        Sound {sound ? 'on' : 'off'}
      </button>
      {permission === 'default' && (
        <button
          type="button"
          className="secondary icon-button"
          onClick={() => void askForDesktopAlerts().then(setPermission)}
        >
          <MonitorCheck size={16} aria-hidden="true" />
          Turn on desktop alerts
        </button>
      )}
      {permission === 'granted' && <span className="muted small">Desktop alerts on</span>}
      {permission === 'denied' && (
        <span className="muted small">Desktop alerts are blocked in this browser’s settings</span>
      )}
    </div>
  );
}
