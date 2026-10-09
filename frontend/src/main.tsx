import { lazy, StrictMode, Suspense, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ConfirmProvider, RouteLoading } from './components';
import { LoginPage } from './features/auth/LoginPage';
import { PatientPage } from './features/patient/PatientPage';
import { QrEntryPage } from './features/patient/QrEntryPage';
import { ScanPage } from './features/patient/ScanPage';
import '@fontsource-variable/inter';
import './styles.css';

// Staff and super admin screens load on demand, so a patient's phone only
// downloads the patient pages.
function page<Name extends string>(load: () => Promise<Record<Name, ComponentType>>, name: Name) {
  return lazy(async () => ({ default: (await load())[name] }));
}
const workspace = () => import('./features/workspace/AdminLayout');
const AdminLayout = page(workspace, 'AdminLayout');
const AdminIndex = page(workspace, 'AdminIndex');
const OverviewPage = page(() => import('./features/workspace/OverviewPage'), 'OverviewPage');
const RequestsPage = page(() => import('./features/requests/RequestsPage'), 'RequestsPage');
const ReportsPage = page(() => import('./features/reports/ReportsPage'), 'ReportsPage');
const PersonReportPage = page(
  () => import('./features/reports/PersonReportPage'),
  'PersonReportPage',
);
const AuditLogPage = page(() => import('./features/reports/AuditLogPage'), 'AuditLogPage');
const HospitalProfilePage = page(
  () => import('./features/hospital/HospitalProfilePage'),
  'HospitalProfilePage',
);
const BedsPage = page(() => import('./features/locations/BedsPage'), 'BedsPage');
const LocationsPage = page(() => import('./features/locations/LocationsPage'), 'LocationsPage');
const DepartmentsPage = page(() => import('./features/people/DepartmentsPage'), 'DepartmentsPage');
const StaffPage = page(() => import('./features/people/StaffPage'), 'StaffPage');
const RolesPage = page(() => import('./features/people/RolesPage'), 'RolesPage');
const EligibilityPage = page(() => import('./features/people/EligibilityPage'), 'EligibilityPage');
const ServicesPage = page(() => import('./features/services/ServicesPage'), 'ServicesPage');
const SlaPage = page(() => import('./features/services/SlaPage'), 'SlaPage');
const PlatformLayout = page(() => import('./features/platform/PlatformLayout'), 'PlatformLayout');
const PlatformLoginPage = page(
  () => import('./features/platform/PlatformLoginPage'),
  'PlatformLoginPage',
);
const PlatformClientsPage = page(
  () => import('./features/platform/PlatformClientsPage'),
  'PlatformClientsPage',
);
const PlatformClientPage = page(
  () => import('./features/platform/PlatformClientPage'),
  'PlatformClientPage',
);
const PlatformHospitalsPage = page(
  () => import('./features/platform/PlatformHospitalsPage'),
  'PlatformHospitalsPage',
);
const PlatformHospitalPage = page(
  () => import('./features/platform/PlatformHospitalPage'),
  'PlatformHospitalPage',
);

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element.');
}
// In development, editing a shared module can re-run this file; reuse the
// existing React root instead of creating a second one on the same element.
const hot = import.meta.hot as { data: { root?: Root } } | undefined;
const root = hot?.data.root ?? createRoot(container);
if (hot) hot.data.root = root;

root.render(
  <StrictMode>
    <BrowserRouter>
      <ConfirmProvider>
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<QrEntryPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* Super admin: manage clients (customers) and their hospitals, nothing inside them. */}
            <Route path="/platform/login" element={<PlatformLoginPage />} />
            <Route path="/platform" element={<PlatformLayout />}>
              <Route index element={<PlatformClientsPage />} />
              <Route path="clients/:id" element={<PlatformClientPage />} />
              <Route path="hospitals" element={<PlatformHospitalsPage />} />
              <Route path="hospitals/:id" element={<PlatformHospitalPage />} />
            </Route>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminIndex />} />
              <Route path="overview" element={<OverviewPage />} />
              <Route path="requests" element={<RequestsPage />} />
              <Route path="hospital" element={<HospitalProfilePage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="reports/people/:membershipId" element={<PersonReportPage />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="beds" element={<BedsPage />} />
              <Route path="locations" element={<LocationsPage />} />
              <Route path="departments" element={<DepartmentsPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="eligibility" element={<EligibilityPage />} />
              <Route path="services" element={<ServicesPage />} />
              <Route path="sla" element={<SlaPage />} />
            </Route>
            {/* Patient flow: a printed QR code opens /q/<token>. */}
            <Route path="/q/:token" element={<ScanPage />} />
            <Route path="/patient" element={<PatientPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ConfirmProvider>
    </BrowserRouter>
  </StrictMode>,
);
