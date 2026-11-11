import React, { useEffect } from 'react';
import { AppShell } from './components/Layout';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AccountRequestsPage } from './pages/AccountRequestsPage';
import { AccountDetailPage, AccountsPage } from './pages/AccountsPage';
import { AdminOnboardingPage, AdminUsersPage } from './pages/AdminPages';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { AuditPage, StatementPage, TransferDetailsPage } from './pages/LedgerPages';
import { ProfilePage, SecurityPage } from './pages/SettingsPages';
import { navigate, usePathname } from './utils/router';

const FinancialTransactionPage = React.lazy(() => import('./pages/FinancialTransactionPage'));

const STATIC_ROUTES = new Set([
  '/login',
  '/register',
  '/accept-invitation',
  '/dashboard',
  '/accounts',
  '/statements',
  '/audit',
  '/profile',
  '/settings',
  '/settings/security',
  '/account-requests',
  '/admin/users',
  '/admin/onboarding',
]);

function RouterView() {
  const pathname = usePathname();
  const {
    isAuthenticated,
    user,
    logout,
    request,
    updateUser,
    accountRefreshVersion,
    refreshAccounts,
    selectedAccountId,
    setSelectedAccountId,
  } = useAuth();

  const isPublicRoute =
    pathname === '/login' || pathname === '/register' || pathname === '/accept-invitation';
  const isAccountDetail = /^\/accounts\/[^/]+$/.test(pathname);
  const isTransaction = /^\/transactions\/(deposit|withdrawal|transfer)$/.test(pathname);
  const isTransferDetail = /^\/transfers\/[^/]+$/.test(pathname);
  const isKnownRoute = STATIC_ROUTES.has(pathname) || isAccountDetail || isTransaction || isTransferDetail;

  const isForbidden =
    !!user &&
    ((pathname === '/account-requests' && user.role !== 'ACCOUNT_HOLDER') ||
      (pathname.startsWith('/admin/') && user.role !== 'ADMIN') ||
      (pathname === '/audit' && !['ADMIN', 'AUDITOR'].includes(user.role)) ||
      (isTransaction && user.role !== 'ACCOUNT_HOLDER'));

  useEffect(() => {
    if (!isAuthenticated && !isPublicRoute) {
      navigate('/login', true);
    } else if (isAuthenticated && isPublicRoute) {
      navigate('/dashboard', true);
    } else if (!isKnownRoute) {
      navigate(isAuthenticated ? '/dashboard' : '/login', true);
    }
  }, [isAuthenticated, isKnownRoute, isPublicRoute, pathname, user?.role]);

  if (!isAuthenticated || !user) {
    const mode =
      pathname === '/register'
        ? 'register'
        : pathname === '/accept-invitation'
          ? 'invitation'
          : 'login';
    return <AuthPage key={mode} mode={mode} />;
  }

  const isAdmin = user.role === 'ADMIN';

  function handlePasswordChanged() {
    logout();
    navigate('/login', true);
  }

  let pageContent: React.ReactNode;
  if (pathname === '/accounts') {
    pageContent = (
      <AccountsPage
        request={request}
        isAdmin={isAdmin}
        userRole={user.role}
        accountRefreshVersion={accountRefreshVersion}
        refreshAccounts={refreshAccounts}
        selectedAccountId={selectedAccountId}
        setSelectedAccountId={setSelectedAccountId}
      />
    );
  } else if (pathname === '/profile' || pathname === '/settings') {
    pageContent = <ProfilePage request={request} user={user} updateUser={updateUser} />;
  } else if (pathname === '/settings/security') {
    pageContent = <SecurityPage request={request} onChanged={handlePasswordChanged} />;
  } else if (pathname === '/account-requests') {
    pageContent = <AccountRequestsPage request={request} />;
  } else if (pathname === '/admin/users' && isAdmin) {
    pageContent = <AdminUsersPage request={request} />;
  } else if (pathname === '/admin/onboarding' && isAdmin) {
    pageContent = <AdminOnboardingPage request={request} refreshAccounts={refreshAccounts} />;
  } else if (pathname === '/statements') {
    pageContent = (
      <StatementPage
        request={request}
        selectedAccountId={selectedAccountId}
        setSelectedAccountId={setSelectedAccountId}
      />
    );
  } else if (isAccountDetail) {
    pageContent = (
      <AccountDetailPage
        accountId={pathname.split('/')[2]}
        request={request}
        selectedAccountId={selectedAccountId}
        setSelectedAccountId={setSelectedAccountId}
      />
    );
  } else if (isTransaction) {
    const txType = pathname.split('/')[2] as 'deposit' | 'withdrawal' | 'transfer';
    pageContent = <FinancialTransactionPage type={txType} onNavigate={navigate} />;
  } else if (isTransferDetail) {
    pageContent = (
      <TransferDetailsPage
        request={request}
        transferId={pathname.split('/')[2]}
        onNavigate={navigate}
      />
    );
  } else if (pathname === '/audit' && ['ADMIN', 'AUDITOR'].includes(user.role)) {
    pageContent = <AuditPage request={request} />;
  } else {
    pageContent = (
      <DashboardPage
        request={request}
        user={user}
        accountRefreshVersion={accountRefreshVersion}
      />
    );
  }

  return (
    <AppShell pathname={pathname} forbidden={isForbidden}>
      {pageContent}
    </AppShell>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RouterView />
    </AuthProvider>
  );
}
