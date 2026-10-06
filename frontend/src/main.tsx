import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AdminIndex, AdminLayout } from './pages/AdminLayout';
import { BedsPage } from './pages/BedsPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { EligibilityPage } from './pages/EligibilityPage';
import { HospitalProfilePage } from './pages/HospitalProfilePage';
import { LocationsPage } from './pages/LocationsPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { PatientPage } from './pages/PatientPage';
import { PlatformHospitalPage } from './pages/platform/PlatformHospitalPage';
import { PlatformHospitalsPage } from './pages/platform/PlatformHospitalsPage';
import { PlatformLayout } from './pages/platform/PlatformLayout';
import { PlatformLoginPage } from './pages/platform/PlatformLoginPage';
import { QrEntryPage } from './pages/QrEntryPage';
import { RequestsPage } from './pages/RequestsPage';
import { RolesPage } from './pages/RolesPage';
import { ScanPage } from './pages/ScanPage';
import { ServicesPage } from './pages/ServicesPage';
import { SlaPage } from './pages/SlaPage';
import { StaffPage } from './pages/StaffPage';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element.');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<QrEntryPage />} />
        <Route path="/login" element={<LoginPage />} />
        {/* SaaS platform administration: onboard and manage client hospitals. */}
        <Route path="/platform/login" element={<PlatformLoginPage />} />
        <Route path="/platform" element={<PlatformLayout />}>
          <Route index element={<PlatformHospitalsPage />} />
          <Route path="hospitals/:id" element={<PlatformHospitalPage />} />
        </Route>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="overview" element={<OverviewPage />} />
          <Route path="requests" element={<RequestsPage />} />
          <Route path="hospital" element={<HospitalProfilePage />} />
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
    </BrowserRouter>
  </StrictMode>,
);
