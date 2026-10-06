# CARE QR Frontend

One React web app (Vite, TypeScript, React Router) for staff administration and the patient QR pages.

```text
src/
├── main.tsx           Routes
├── api.ts             Backend client, response types, and token storage
├── components.tsx     Shared UI (forms, retry states, notices, native modal)
├── styles.css
└── pages/
    ├── QrEntryPage.tsx    /: patient-first camera scanner and QR-link entry
    ├── LoginPage.tsx      Staff sign-in
    ├── AdminLayout.tsx    Staff shell; validates the session once
    ├── LocationsPage.tsx  Building → Floor → Ward → Room → Bed setup
    ├── BedsPage.tsx       Bed sessions and QR codes (generate, rotate, revoke, print)
    ├── DepartmentsPage.tsx
    ├── StaffPage.tsx      Staff list, duty toggle, and adding staff
    ├── StaffDialog.tsx    Status, departments, coverage, roles, and shifts of one person
    ├── staff-directory.ts Data and labels shared by the staff screens
    ├── ServicesPage.tsx   Service catalog and categories
    ├── SlaPage.tsx        SLA policies (versioned) and escalation policies
    ├── EligibilityPage.tsx  "Who can respond?" for a bed and department
    ├── ScanPage.tsx       /q/<token>: exchanges a QR token for a guest session
    └── PatientPage.tsx    Language choice, service requests, status, and cancellation
```

Run `npm run dev` with the backend running on port 3001; see the root [README](../README.md).

The website opens on the patient QR entry screen. Staff use **Staff sign in**. The QR decoder loads only when requested and reads CARE QR links for this website; patients can scan live, take/choose a QR photo (decoded locally without upload), or paste a link. Printed QR links still open `/q/<token>` directly. Live camera permission requires HTTPS or localhost; a plain HTTP LAN address can use QR-photo capture, the phone's Camera app, or a pasted link.

Staff tokens are kept in `localStorage` until their 8-hour session ends. Guest tokens are kept in `sessionStorage`, so a patient's access lasts only for the tab that scanned the code.

Navigation and management controls reflect the signed-in staff member's permissions; backend authorization remains authoritative. If a browser blocks storage, credentials remain in memory only until refresh. Network failures offer retry, and the patient page rechecks guest-session revocation/expiry while open.

After scanning, patients can choose English or Hindi, send a request from the published service catalog, track requests from the current bed stay, refresh status, and cancel before staff accepts the request. Active duplicate requests link to the existing request. The page refreshes statuses while visible and clearly warns that automatic routing and staff alerts are not available yet; a newly sent request remains **Submitted** until staff process it. Feedback collection is planned for a later phase.

`npm test` runs the frontend interaction regressions in `tests/` (Vitest and Testing Library). Run it alongside lint, typecheck, formatting, and build before continuing a phase. Native focus trapping and responsive layout should also be checked in a real browser.
