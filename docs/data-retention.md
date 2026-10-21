# Data retention

CARE QR removes expired operational records inside the API process. The worker runs once at startup and then every `RETENTION_INTERVAL_HOURS` (24 by default). A failed run is logged and retried; shutdown waits for a run already in progress.

| Record | Default | Removal rule |
| --- | ---: | --- |
| Staff, platform, and guest sessions | 30 days | Expired or revoked before the cutoff |
| Staff inbox notifications | 180 days | Created before the cutoff |
| Notification dispatch receipts | 180 days | Processed before the cutoff |
| Hospital audit log | no development default | Created before the explicitly configured cutoff |

Production startup requires `AUDIT_RETENTION_DAYS` between 30 and 3650. The value is deliberately not guessed by the application: the hospital's records/governance owner must choose it for the applicable contracts and regulations. `SESSION_RETENTION_DAYS` and `NOTIFICATION_RETENTION_DAYS` can also be changed within the validated ranges in `services/.env.example`.

The notification worker ignores source events older than the notification retention window. This prevents a removed dispatch receipt from causing an old request event to be delivered again. Request events and request history are not deleted by this worker.

The API logs counts after a run removes data. Review those structured `removed` counts as part of normal operations. Test policy changes against a restored non-production database before changing a live value.
