import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { io } from 'socket.io-client';
import { ApiError, notificationApi, type StaffNotification } from '../../api';
import { Modal } from '../../components';
import { alertSound, playChime } from '../../lib/request-alerts';

const merge = (first: StaffNotification[], rest: StaffNotification[]) => {
  const ids = new Set(first.map((item) => item.id));
  return [...first, ...rest.filter((item) => !ids.has(item.id))];
};
const labels: Record<string, string> = {
  SUBMITTED: 'New request',
  ASSIGNED: 'Assignment',
  TRANSFERRED: 'Handover',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REJECTED: 'Needs attention',
  ESCALATED: 'Escalation',
};

export function NotificationBell({
  token,
  timezone,
  onUnauthorized,
}: {
  token: string;
  timezone: string;
  onUnauthorized: (cause: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StaffNotification[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const known = useRef<Set<string> | null>(null);
  const sequence = useRef(0);
  const loadedOlder = useRef(false);
  const changing = useRef(false);
  const fail = useCallback(
    (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications.');
      if (
        cause instanceof ApiError &&
        (cause.status === 401 || cause.code === 'PASSWORD_CHANGE_REQUIRED')
      )
        onUnauthorized(cause);
    },
    [onUnauthorized],
  );
  const refresh = useCallback(async () => {
    if (changing.current) return;
    const current = ++sequence.current;
    try {
      const page = await notificationApi.list(token);
      if (current !== sequence.current) return;
      const fresh = known.current
        ? page.items.filter((item) => !known.current!.has(item.id) && !item.readAt)
        : [];
      known.current = new Set([
        ...page.items.map((item) => item.id),
        ...[...(known.current ?? [])].slice(0, 480),
      ]);
      setItems((previous) => merge(page.items, previous));
      if (!loadedOlder.current) setCursor(page.nextCursor);
      setCount(page.unreadCount);
      setError(null);
      if (fresh.length) {
        setAnnouncement(
          fresh.length === 1
            ? fresh[0]!.title
            : `${fresh.length} new notifications need your attention.`,
        );
        // Existing request alerts handle new/overdue sounds. Add a chime only
        // for assignments, which that feed does not announce.
        if (
          alertSound.enabled() &&
          fresh.some((item) => ['ASSIGNED', 'TRANSFERRED'].includes(item.type))
        )
          playChime();
      }
    } catch (cause) {
      if (current === sequence.current) fail(cause);
    }
  }, [token, fail]);

  useEffect(() => {
    known.current = null;
    loadedOlder.current = false;
    const socket = io(import.meta.env.VITE_API_URL || window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    const reconnect = () => {
      setConnected(true);
      void refresh();
    };
    const disconnect = () => setConnected(false);
    const changed = () => void refresh();
    socket.on('connect', reconnect);
    socket.on('disconnect', disconnect);
    socket.on('connect_error', disconnect);
    socket.on('notification.created', changed);
    const initial = window.setTimeout(changed, 0);
    // Persistent API recovery works even when realtime/proxy is unavailable.
    const poll = window.setInterval(changed, 30_000);
    return () => {
      sequence.current += 1;
      window.clearTimeout(initial);
      window.clearInterval(poll);
      socket.off('connect', reconnect);
      socket.off('disconnect', disconnect);
      socket.off('connect_error', disconnect);
      socket.off('notification.created', changed);
      socket.disconnect();
    };
  }, [token, refresh]);

  async function more() {
    if (!cursor || changing.current) return;
    changing.current = true;
    setBusy(true);
    const current = ++sequence.current;
    try {
      const page = await notificationApi.list(token, cursor);
      if (current !== sequence.current) return;
      loadedOlder.current = true;
      setItems((previous) => merge(previous, page.items));
      setCursor(page.nextCursor);
      setCount(page.unreadCount);
      setError(null);
    } catch (cause) {
      if (current === sequence.current) fail(cause);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }
  async function read(id: string) {
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    sequence.current += 1;
    try {
      const result = await notificationApi.read(token, id);
      setItems((previous) =>
        previous.map((item) =>
          item.id === id ? { ...item, readAt: new Date().toISOString() } : item,
        ),
      );
      setCount(result.unreadCount);
      setError(null);
      changing.current = false;
      await refresh();
    } catch (cause) {
      fail(cause);
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="secondary notification-bell"
        aria-label={`Notifications${count === null ? '' : `, ${count} unread`}`}
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
      >
        <Bell size={18} aria-hidden="true" />
        {count !== null && count > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {announcement && (
        <div className="notification-toast" role="status">
          <Bell size={16} aria-hidden="true" />
          <span>{announcement}</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setOpen(true);
              setAnnouncement('');
            }}
          >
            View
          </button>
          <button
            type="button"
            className="secondary"
            aria-label="Dismiss notification alert"
            onClick={() => setAnnouncement('')}
          >
            ×
          </button>
        </div>
      )}
      {open && (
        <Modal title="Your notifications" onClose={() => setOpen(false)}>
          <p className="muted small">
            {connected
              ? 'Live updates connected.'
              : 'Live updates reconnecting. Inbox checks continue every 30 seconds.'}{' '}
            Reading a notification does not accept a request.
          </p>
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button type="button" className="secondary" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {count === null && !error && <p role="status">Loading notifications…</p>}
          {count !== null && items.length === 0 && <p>No notifications yet.</p>}
          <ul className="notification-list">
            {items.map((item) => (
              <li key={item.id} className={item.readAt ? '' : 'notification-unread'}>
                <div className="notification-item-heading">
                  <strong>{item.title}</strong>
                  <span className="small">{item.readAt ? 'Read' : 'Unread'}</span>
                </div>
                <p>{item.message}</p>
                <p className="muted small">
                  {labels[item.type] ?? item.type} · {item.priority} ·{' '}
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString(undefined, { timeZone: timezone })}
                  </time>
                </p>
                {item.requestReference && (
                  <p className="small">Reference: {item.requestReference}</p>
                )}
                <div className="notification-actions">
                  {!item.readAt && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void read(item.id)}
                    >
                      Mark as read
                    </button>
                  )}
                  {item.requestId && (
                    <Link
                      className="button secondary"
                      to={`/admin/requests?request=${item.requestId}`}
                      onClick={() => setOpen(false)}
                    >
                      Open request
                    </Link>
                  )}
                  {!item.requestId && (
                    <span className="muted small">Request no longer available in your area.</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {cursor && (
            <button type="button" className="secondary" disabled={busy} onClick={() => void more()}>
              {busy ? 'Loading…' : 'Load older notifications'}
            </button>
          )}
        </Modal>
      )}
    </>
  );
}
