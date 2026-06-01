import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';

const Dashboard = lazy(() => import('@/pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Network = lazy(() => import('@/pages/Network').then((m) => ({ default: m.Network })));
const Accounts = lazy(() => import('@/pages/Accounts').then((m) => ({ default: m.Accounts })));
const AccountDetail = lazy(() => import('@/pages/AccountDetail').then((m) => ({ default: m.AccountDetail })));
const Transactions = lazy(() => import('@/pages/Transactions').then((m) => ({ default: m.Transactions })));
const TransactionDetail = lazy(() => import('@/pages/TransactionDetail').then((m) => ({ default: m.TransactionDetail })));
const Ledgers = lazy(() => import('./pages/Ledgers').then((m) => ({ default: m.Ledgers })));
const Assets = lazy(() => import('@/pages/Assets').then((m) => ({ default: m.Assets })));
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })));
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const NotFound = lazy(() => import('@/pages/NotFound').then((m) => ({ default: m.NotFound })));

function App() {
  return (
    <Suspense fallback={null}>
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
          <Route index element={<Dashboard />} />
          <Route path="network" element={<Network />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="accounts/:accountId" element={<AccountDetail />} />
          <Route path="transactions" element={<Transactions />} />
          <Route path="transactions/:hash" element={<TransactionDetail />} />
          <Route path="ledgers" element={<Ledgers />} />
          <Route path="assets" element={<Assets />} />
          <Route path="search" element={<SearchPage />} />
        </Route>

        {/* 404 - Not Found */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;
