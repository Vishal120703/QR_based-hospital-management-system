import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AdminLayout } from './pages/AdminLayout';
import { BedsPage } from './pages/BedsPage';
import { LocationsPage } from './pages/LocationsPage';
import { LoginPage } from './pages/LoginPage';
import { PatientPage } from './pages/PatientPage';
import { ScanPage } from './pages/ScanPage';
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
          <Route index element={<Navigate to="beds" replace />} />
          <Route path="beds" element={<BedsPage />} />
          <Route path="locations" element={<LocationsPage />} />
        </Route>
        {/* Patient flow: a printed QR code opens /q/<token>. */}
        <Route path="/q/:token" element={<ScanPage />} />
        <Route path="/patient" element={<PatientPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
