# Security — bounded first-run evidence

Status: PARTIAL. Stage 9 not executed. Separate auth-domain checks passed; no cross-hospital read/write was observed in the exercised cases. A confirmed same-hospital staff identity scope defect is AUD-001. This blocks declaring authorization/security fully passed.

npm registry audits report zero known backend/frontend dependency advisories at audit time. Current tracked environment filenames are templates only; a filename-history query found no matching committed secret files. No full content/history/distribution secret scan was performed.

localStorage/sessionStorage credential design, practical XSS sinks, CSP/security headers, unsafe uploads, CORS/TRUST_PROXY, process-local limits, logging and hosted ingress remain unverified here. No hypothetical storage vulnerability is asserted merely because localStorage is used.

## Update 2026-10-12

- Password management: staff change their own password (current password required, other sessions ended, rate limited); staff managers reset a forgotten one with a temporary password (only for people whose permissions they hold, not themselves, not accounts also used at another hospital or the platform), which ends that person's sessions and forces a new password before anything else works. Audited without passwords; new fields added to log redaction.
- Web headers (`frontend/vercel.json`): Referrer-Policy no-referrer, X-Frame-Options DENY plus CSP frame-ancestors 'none', a Permissions-Policy allowing only this site's camera, nosniff. A build-time Content Security Policy allows only the app's own scripts, styles, and fonts and the API named by VITE_API_URL (no unsafe-inline or unsafe-eval). End-to-end tests run under these headers, confirm a call to another site is blocked, and confirm the QR labels PDF still opens.
- Token storage: the staff token stays in localStorage (patient tokens in sessionStorage). Moving to httpOnly cookies would need the web app and API under one site (a custom domain) because they are on different hosts today; not changed. The CSP limits the main risk (injected script reading the token). This remains a known limitation.
- Still unverified: a full secret-history scan, upload handling review, and hosted ingress behavior.
