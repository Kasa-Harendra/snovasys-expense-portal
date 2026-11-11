import React, { useEffect, useState } from 'react';
import { checkReadiness, getNavForRole, ROLE_LABELS } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types';
import { navigate } from '../utils/router';
import { Brand, Icon } from './Icons';

function BackendStatusBadge() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    const controller = new AbortController();
    checkReadiness(controller.signal)
      .then((ok) => setStatus(ok ? 'online' : 'offline'))
      .catch(() => {});

    const interval = window.setInterval(() => {
      checkReadiness(controller.signal)
        .then((ok) => setStatus(ok ? 'online' : 'offline'))
        .catch(() => {});
    }, 30000);

    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  const label = {
    checking: 'Checking system',
    online: 'Systems operational',
    offline: 'Connection unavailable',
  }[status];

  return (
    <div className={`backend-badge backend-${status}`} title="Database readiness status">
      <i />
      {label}
    </div>
  );
}

function ProfileMenu({ user, signOut }: { user: User; signOut: () => void }) {
  const [open, setOpen] = useState(false);
  const initial = (user.fullName?.[0] || user.email[0] || '?').toUpperCase();

  return (
    <div className="profile-menu-wrap">
      <button
        className="profile-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="avatar">{initial}</span>
        <span className="profile-menu-identity">
          <strong>{user.fullName || user.email}</strong>
          <small>{ROLE_LABELS[user.role] ?? user.role}</small>
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="profile-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/profile');
            }}
          >
            Profile
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            Settings
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings/security');
            }}
          >
            Security
          </button>
          <button role="menuitem" onClick={signOut}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function getBreadcrumbTitle(pathname: string): string {
  if (pathname.startsWith('/accounts/')) return 'Account details';
  if (pathname.startsWith('/transactions/')) {
    const sub = pathname.split('/')[2] || '';
    return sub ? sub[0].toUpperCase() + sub.slice(1) : 'Transaction';
  }
  if (pathname.startsWith('/transfers/')) return 'Transfer details';
  if (pathname === '/accounts') return 'Accounts';
  if (pathname === '/statements') return 'Statements';
  if (pathname === '/audit') return 'Audit log';
  return 'Overview';
}

export function AppShell({
  pathname,
  forbidden = false,
  children,
}: {
  pathname: string;
  forbidden?: boolean;
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  if (!user) return null;

  const navItems = getNavForRole(user.role);

  function handleSignOut() {
    logout();
    navigate('/login', true);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenuOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand inverse />
          <button
            className="mobile-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation"
          >
            ×
          </button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <a
              key={item.path}
              href={item.path}
              aria-current={pathname === item.path ? 'page' : undefined}
              className={`nav-link ${pathname === item.path ? 'nav-active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.path === '/accounts' && <span className="nav-chevron">›</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-security">
            <span className="security-icon">
              <Icon name="shield" size={17} />
            </span>
            <div>
              <strong>Protected ledger</strong>
              <small>Secure by design</small>
            </div>
            <span className="security-check">✓</span>
          </div>
          <div className="sidebar-version">
            BALANCEVAULT <span>·</span> PRIVATE
          </div>
        </div>
      </aside>

      {mobileMenuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-leading">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            >
              <span />
              <span />
              <span />
            </button>
            <div className="breadcrumb">
              <span>Workspace</span>
              <b>/</b>
              <strong>{getBreadcrumbTitle(pathname)}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <BackendStatusBadge />
            <span className="topbar-divider" />
            <ProfileMenu user={user} signOut={handleSignOut} />
          </div>
        </header>

        <main className="page-content">
          {forbidden && pathname !== '/accounts' ? (
            <section className="section-block role-dashboard-panel">
              <span className="section-kicker">ACCESS RESTRICTED</span>
              <h1>Access denied</h1>
              <p>Your current role cannot open this page.</p>
              <button className="button button-outline" onClick={() => navigate('/dashboard')}>
                Return to overview
              </button>
            </section>
          ) : (
            <React.Suspense
              fallback={
                <div className="loading-row" role="status">
                  <span className="spinner spinner-dark" />
                  Loading workspace
                </div>
              }
            >
              {children}
            </React.Suspense>
          )}
        </main>

        <footer className="app-footer">
          <span>
            BalanceVault <i>·</i> Financial clarity, by design.
          </span>
          <span className="footer-secure">
            <Icon name="lock" size={13} /> Secure session
          </span>
        </footer>
      </div>
    </div>
  );
}
