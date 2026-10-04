import { lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';

// Signed-in screens load on demand; the briefing also pulls in the chart library.
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const InboxPage = lazy(() => import('@/pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const SendersPage = lazy(() => import('@/pages/SendersPage').then((m) => ({ default: m.SendersPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));

// Old /inbox/:emailId links carried the message in the path. The inbox keeps
// the open message in `?selected=`, so translate instead of dropping the id.
function InboxMessageRedirect() {
  const { emailId } = useParams();
  return <Navigate to={emailId ? `/inbox?selected=${encodeURIComponent(emailId)}` : '/inbox'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:emailId" element={<InboxMessageRedirect />} />
        <Route path="/senders" element={<SendersPage />} />
        {/* The old route name, kept so bookmarks still land. */}
        <Route path="/sender-lists" element={<Navigate to="/senders" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/inbox" replace />} />
      <Route path="*" element={<Navigate to="/inbox" replace />} />
    </Routes>
  );
}
