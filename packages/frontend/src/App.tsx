import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Dashboard } from '@/pages/Dashboard';
import { Network } from '@/pages/Network';
import { Accounts } from '@/pages/Accounts';
import { Transactions } from '@/pages/Transactions';
import { Assets } from '@/pages/Assets';
import { AccountDetail } from '@/pages/AccountDetail';
import { TransactionDetail } from '@/pages/TransactionDetail';
import { NotFound } from '@/pages/NotFound';
import { Ledgers } from './pages/Ledgers';
import { SearchPage } from './pages/Search';
import { Login } from './pages/Login';

function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />

      {/* Protected routes - require authentication */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
        <Route path="network" element={<ErrorBoundary><Network /></ErrorBoundary>} />
        <Route path="accounts" element={<ErrorBoundary><Accounts /></ErrorBoundary>} />
        <Route path="accounts/:accountId" element={<ErrorBoundary><AccountDetail /></ErrorBoundary>} />
        <Route path="transactions" element={<ErrorBoundary><Transactions /></ErrorBoundary>} />
        <Route path="transactions/:hash" element={<ErrorBoundary><TransactionDetail /></ErrorBoundary>} />
        <Route path="ledgers" element={<ErrorBoundary><Ledgers /></ErrorBoundary>} />
        <Route path="assets" element={<ErrorBoundary><Assets /></ErrorBoundary>} />
        <Route path="search" element={<ErrorBoundary><SearchPage /></ErrorBoundary>} />
      </Route>

      {/* 404 - Not Found */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export default App;
