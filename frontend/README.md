# CARE QR Frontend

One React web app (Vite, TypeScript, React Router) for staff administration and the patient QR pages.

```text
src/
├── main.tsx           Routes
├── api.ts             Backend client, response types, and token storage
├── components.tsx     Shared UI (create form, notices)
├── styles.css
└── pages/
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
    └── PatientPage.tsx    What a patient sees after scanning
```

Run `npm run dev` with the backend running on port 3000; see the root [README](../README.md).

Staff tokens are kept in `localStorage` until their 8-hour session ends. Guest tokens are kept in `sessionStorage`, so a patient's access lasts only for the tab that scanned the code.
