import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AdminIndex, AdminLayout } from './pages/AdminLayout';
import { BedsPage } from './pages/BedsPage';
import { DepartmentsPage } from './pages/DepartmentsPage';
import { EligibilityPage } from './pages/EligibilityPage';
import { LocationsPage } from './pages/LocationsPage';
import { LoginPage } from './pages/LoginPage';
import { PatientPage } from './pages/PatientPage';
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
        <Route path="/" element={<Navigate to="/admin" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route path="beds" element={<BedsPage />} />
          <Route path="locations" element={<LocationsPage />} />
          <Route path="departments" element={<DepartmentsPage />} />
          <Route path="staff" element={<StaffPage />} />
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
