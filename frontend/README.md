# CARE QR Frontend

One React web app (Vite, TypeScript, React Router) for staff administration and the patient QR pages.

```text
src/
├── main.tsx           Routes
├── api/               Backend client split by staff, patient, platform, and reports
├── components/        Shared UI (forms, retry states, notices, native modal)
├── lib/               Shared helpers: useLoad (screen data), field-rules (input limits), QR PDF, logos, request status
├── styles.css
└── features/
    ├── patient/        Starting page, QR resolution, and request tracking
    ├── auth/           Staff sign-in
    ├── workspace/      Permission-aware shell and overview
    ├── locations/      Hierarchy, beds, sessions, and QR labels
    ├── people/         Staff, departments, roles, and eligibility
    ├── services/       Catalog and SLA screens
    ├── requests/       Manager/staff workflow and request history
    ├── reports/        Reports and audit log
    ├── hospital/       Hospital profile and logo
    └── platform/       Separate CARE QR platform administration
```

Run `npm run dev` with the backend running on port 3001; see the root [README](../README.md).

The website opens on the patient QR entry screen. Staff use **Staff sign in**. The QR decoder loads only when requested and reads CARE QR links for this website; patients can scan live, take/choose a QR photo (decoded locally without upload), or paste a link. Printed QR links still open `/q/<token>` directly. Live camera permission requires HTTPS or localhost; a plain HTTP LAN address can use QR-photo capture, the phone's Camera app, or a pasted link.

Staff tokens are kept in `localStorage` until their 8-hour session ends. Guest tokens are kept in `sessionStorage`, so a patient's access lasts only for the tab that scanned the code.

Screens load their data with `useLoad` (`src/lib/use-load.ts`): it keeps data on screen while refreshing, ignores out-of-date answers, shows load errors on the screen with **Try again**, and signs out only when the session has expired. Form inputs take their limits from `src/lib/field-rules.ts`, which mirrors the server's validation, so mistakes are caught before anything is sent.

Navigation and management controls reflect the signed-in staff member's permissions; backend authorization remains authoritative. If a browser blocks storage, credentials remain in memory only until refresh. Network failures offer retry, and the patient page rechecks guest-session revocation/expiry while open.

The staff workspace uses Lucide React icons for navigation cues while keeping text labels; on narrow screens, the menu stays collapsed until opened. Styling remains in the existing CSS rather than adding a second component or styling system.

After scanning, patients can choose English or Hindi, send a request from the published service catalog, track requests from the current bed stay, refresh status, and cancel before staff accepts the request. Active duplicate requests link to the existing request. The page refreshes statuses while visible and clearly warns that automatic routing and staff alerts are not available yet; a newly sent request remains **Submitted** until staff process it. Feedback collection is planned for a later phase.

`npm test` runs the frontend interaction regressions in `tests/` (Vitest and Testing Library). Run it alongside lint, typecheck, formatting, and build before continuing a phase. Native focus trapping and responsive layout should also be checked in a real browser.
