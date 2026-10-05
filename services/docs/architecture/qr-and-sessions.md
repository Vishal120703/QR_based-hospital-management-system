# QR Codes, Bed Sessions, and Guest Sessions

Status: Implemented in Phase 4  
Last reviewed: 2026-10-05

## Flow

```text
Printed QR  →  /q/<token>  →  POST /public/qr/resolve  →  GuestSession  →  /patient
                                 checks: QR active, bed active,
                                 hospital active, BedSession active
```

The patient never creates an account. Everything a public endpoint knows about the caller (hospital, bed, BedSession) comes from the server-side GuestSession, never from client input; extra fields such as `bedId` are rejected with `400`.

## QR codes

- One `BedQrCode` per bed. Tokens are 256-bit random values (43 base64url characters). Only their SHA-256 hash is stored.
- The raw token is returned once, by `generate` or `rotate`, with `Cache-Control: no-store`. To get a printable code again, rotate it.
- **Rotate** replaces the hash and increments `version`; the old printed code stops working immediately. **Revoke** disables the code until it is generated again.
- Rotating or revoking ends every guest session of that bed, in the same transaction, because the old code may have leaked.
- Every resolution failure (unknown, revoked, rotated, inactive bed, no active BedSession, suspended hospital) returns the same `404 QR_UNAVAILABLE`, so a scan reveals nothing about why it failed.
- Resolution is rate-limited per client IP (default 30 per minute) and returns `429 RATE_LIMITED` with `Retry-After`.
- The token is sent in the request body, never in an API URL, so it does not appear in access logs. The frontend replaces `/q/<token>` with `/patient` after resolution and sets `Referrer-Policy: no-referrer`.

## Bed sessions

- A BedSession is one occupancy period of a bed, without patient identity. Staff with `bedSession.manage` start and close it manually; HIS/ADT automation is deferred.
- Starting moves the bed `AVAILABLE → OCCUPIED` with a conditional update, so concurrent starts cannot both succeed. A partial unique index (`BedSession_one_active_per_bed`) enforces one active session per bed in the database itself.
- Closing moves the bed back to `AVAILABLE` and revokes every guest session of that BedSession in the same transaction.
- Only an active bed with status `AVAILABLE` can start a session (not `MAINTENANCE` or `INACTIVE`).

## Guest sessions

- Created only by QR resolution. Short-lived: `GUEST_SESSION_TTL_MINUTES` (default 120) from creation, not extended by activity. When it ends, the patient scans the QR again.
- Sent as `Authorization: Bearer <token>`; the frontend keeps it in `sessionStorage`, so it lasts only for that browser tab.
- Valid only while not revoked, not expired, its BedSession is `ACTIVE`, and its hospital is `ACTIVE`.
- Staff and guest tokens are separate credential domains: a guest token is rejected by `/admin` routes and a staff token by `/public` routes.

## API

| Method | Path | Permission |
|---|---|---|
| `GET` | `/admin/qr-codes?bedId=` | `bed.read` |
| `POST` | `/admin/beds/:id/qr` | `qr.generate` |
| `POST` | `/admin/beds/:id/qr/rotate` | `qr.rotate` |
| `POST` | `/admin/beds/:id/qr/revoke` | `qr.revoke` |
| `GET` | `/admin/bed-sessions?bedId=&status=` (newest 100) | `bed.read` |
| `POST` | `/admin/bed-sessions` `{ bedId }` | `bedSession.manage` |
| `POST` | `/admin/bed-sessions/:id/close` | `bedSession.manage` |
| `POST` | `/public/qr/resolve` `{ token }` | none (rate-limited) |
| `GET` | `/public/session` | guest session |

`bedSession.manage` is new in Phase 4. Its migration grants it to every existing role that holds `bed.manage`.

All QR and BedSession changes are audited (`qr.generate`, `qr.rotate`, `qr.revoke`, `bedSession.start`, `bedSession.close`) without tokens or token hashes.

## Known limitations

- A photographed QR code keeps working across admissions until it is rotated. Rotate a code whenever it may have been copied.
- The rate limiter counts per backend process. Running several backend instances, or running behind a reverse proxy, needs a shared store and Express `trust proxy` (security hardening phase).
