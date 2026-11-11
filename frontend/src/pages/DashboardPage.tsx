import React, { useEffect, useState } from 'react';
import {
  AuthedRequestFn,
  fetchAccounts,
  fetchAccountStatement,
  ROLE_LABELS,
} from '../api/client';
import { EmptyState, Icon } from '../components/Icons';
import type { Account, StatementResponse, User } from '../types';
import { navigate } from '../utils/router';
import { StatementEventRow } from './LedgerPages';

function AccountRow({ account }: { account: Account }) {
  return (
    <article className="account-row">
      <span className="account-symbol">
        <Icon name={account.type === 'BUSINESS' ? 'building' : 'cards'} size={18} />
      </span>
      <span className="account-row-main">
        <strong>{account.accountNumber}</strong>
        <small>{account.type === 'BUSINESS' ? 'Business account' : 'Personal account'}</small>
      </span>
      <span className={`status-pill status-${account.status.toLowerCase()}`}>
        <i />
        {account.status.toLowerCase()}
      </span>
      <span className="account-currency">{account.currencyCode}</span>
    </article>
  );
}

function QuickActionCard({
  title,
  label,
  tone,
  onClick,
}: {
  title: string;
  label: string;
  tone: 'sage' | 'cream' | 'lavender';
  onClick: () => void;
}) {
  return (
    <button
      className={`action-card action-${tone}`}
      type="button"
      onClick={onClick}
      aria-label={`${title} transaction`}
    >
      <span className="action-icon">
        <Icon name="plus" size={19} />
      </span>
      <span className="action-title">{title}</span>
      <span className="action-label">{label}</span>
      <span className="action-soon">OPEN</span>
    </button>
  );
}

function DashboardActivity({ request, accounts }: { request: AuthedRequestFn; accounts: Account[] | null }) {
  const [statement, setStatement] = useState<StatementResponse | null>(null);
  const [error, setError] = useState('');
  const primaryAccount = accounts?.[0];

  useEffect(() => {
    if (!primaryAccount) {
      setStatement(null);
      return;
    }

    const controller = new AbortController();
    setError('');
    setStatement(null);

    fetchAccountStatement(request, primaryAccount.id, { limit: 5, signal: controller.signal })
      .then(setStatement)
      .catch((err: any) => {
        if (err?.name !== 'AbortError') {
          setError(
            err?.status === 403
              ? 'You do not have permission to view this account activity.'
              : err?.message || 'Activity could not be loaded.'
          );
        }
      });

    return () => controller.abort();
  }, [primaryAccount?.id, request]);

  return (
    <section className="section-block activity-block">
      <div className="section-heading">
        <div>
          <span className="section-kicker">LEDGER</span>
          <h2>Transaction activity</h2>
        </div>
        {primaryAccount && (
          <button className="text-link" onClick={() => navigate('/statements')}>
            Full statements <Icon name="arrow" size={16} />
          </button>
        )}
      </div>

      {!accounts && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading account activity
        </div>
      )}

      {accounts?.length === 0 && (
        <EmptyState
          title="No accounts available"
          detail="Account activity will appear when you have access to an account."
          icon="activity"
        />
      )}

      {primaryAccount && !statement && !error && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading ledger activity
        </div>
      )}

      {error && (
        <div className="ledger-error" role="alert">
          <span>{error}</span>
          <button className="button button-outline" onClick={() => navigate('/statements')}>
            Open statements
          </button>
        </div>
      )}

      {statement?.events.length === 0 && (
        <EmptyState
          title="No transaction activity yet"
          detail="Posted entries and refused attempts will appear in the account statement."
          icon="activity"
        />
      )}

      {statement && statement.events.length > 0 && (
        <>
          <div className="statement-list dashboard-statement-list">
            {statement.events.map((event) => (
              <StatementEventRow
                key={`${event.status}:${event.id}`}
                event={event}
                currencyCode={statement.account.currencyCode}
                compact
              />
            ))}
          </div>
          <p className="statement-order-note">Entries shown in the order supplied by the account ledger.</p>
        </>
      )}
    </section>
  );
}

export function DashboardPage({
  request,
  user,
  accountRefreshVersion,
}: {
  request: AuthedRequestFn;
  user: User;
  accountRefreshVersion: number;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchAccounts(request, { signal: controller.signal })
      .then(setAccounts)
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(err?.message || 'Unable to load accounts.');
      });
    return () => controller.abort();
  }, [accountRefreshVersion, request]);

  const firstName = user.fullName?.split(/\s+/)[0] || user.email.split('@')[0];
  const activeCount = accounts?.filter((a) => a.status === 'ACTIVE').length ?? 0;

  return (
    <>
      <section className="welcome-panel">
        <div className="welcome-copy">
          <div className="welcome-date">
            <span className="welcome-spark">✳</span> YOUR FINANCIAL OVERVIEW
          </div>
          <h1>
            Good to see you, <em>{firstName}</em>
          </h1>
          <p>Everything in its place. Here’s your account overview.</p>
          <div className="welcome-role">
            <span className="role-dot" />
            {ROLE_LABELS[user.role] ?? 'Member'} <span className="welcome-separator">·</span> Private workspace
          </div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <span className="art-ring ring-a" />
          <span className="art-ring ring-b" />
          <span className="art-coin">
            b<span>.</span>
          </span>
          <span className="art-orbit-dot" />
        </div>
        <div className="welcome-index">
          01 <span>/</span> 03
        </div>
      </section>

      <section className="section-block account-overview-block">
        <div className="section-heading">
          <div>
            <span className="section-kicker">YOUR SPACE</span>
            <h2>Account overview</h2>
          </div>
          <button className="text-link" onClick={() => navigate('/accounts')}>
            All accounts <Icon name="arrow" size={16} />
          </button>
        </div>

        <div className="summary-grid">
          <div className="summary-card account-count-card">
            <span className="summary-icon">
              <Icon name="cards" size={19} />
            </span>
            <span className="summary-label">Total accounts</span>
            <strong>{accounts === null ? '—' : accounts.length.toString().padStart(2, '0')}</strong>
            <small>
              {accounts === null
                ? 'Loading account data'
                : accounts.length === 1
                  ? 'Account connected'
                  : 'Accounts connected'}
            </small>
            <div className="summary-decoration" aria-hidden="true" />
          </div>

          <div className="summary-card">
            <span className="summary-icon summary-icon-light">
              <Icon name="shield" size={19} />
            </span>
            <span className="summary-label">Account status</span>
            <strong className="summary-status">
              {accounts === null ? '—' : accounts.length === 0 ? 'No accounts' : 'In good order'}
            </strong>
            <small>
              {accounts === null
                ? 'Checking your accounts'
                : `${activeCount} active ${activeCount === 1 ? 'account' : 'accounts'}`}
            </small>
            <span className="summary-status-line">
              <i />
            </span>
          </div>
        </div>

        {error && (
          <div className="inline-error" role="alert">
            <span>We couldn’t load your accounts.</span>
            <small>{error}</small>
            <button onClick={() => window.location.reload()}>Try again</button>
          </div>
        )}
      </section>

      <div className="dashboard-lower-grid">
        <section className="section-block account-list-block">
          <div className="section-heading compact-heading">
            <div>
              <span className="section-kicker">CONNECTED</span>
              <h2>Your accounts</h2>
            </div>
            <button className="square-link" onClick={() => navigate('/accounts')} aria-label="View all accounts">
              <Icon name="arrow" size={17} />
            </button>
          </div>

          {accounts === null ? (
            <div className="loading-row">
              <span className="spinner spinner-dark" />
              Loading accounts
            </div>
          ) : accounts.length === 0 ? (
            <>
              <EmptyState
                title="No accounts yet"
                detail="Customer accounts are opened after an administrator reviews your request."
              />
              {user.role === 'ACCOUNT_HOLDER' && (
                <button className="button button-outline" onClick={() => navigate('/account-requests')}>
                  Request an account
                </button>
              )}
            </>
          ) : (
            <div className="account-list">
              {accounts.slice(0, 4).map((acc) => (
                <AccountRow key={acc.id} account={acc} />
              ))}
            </div>
          )}

          {accounts && accounts.length > 4 && (
            <button className="view-all-link" onClick={() => navigate('/accounts')}>
              View all {accounts.length} accounts <Icon name="arrow" size={15} />
            </button>
          )}
        </section>

        {user.role === 'ACCOUNT_HOLDER' && (
          <section className="section-block quick-actions-block">
            <div className="section-heading compact-heading">
              <div>
                <span className="section-kicker">ON YOUR TERMS</span>
                <h2>Quick actions</h2>
              </div>
            </div>
            <div className="quick-actions">
              <QuickActionCard
                title="Deposit"
                label="Add funds"
                tone="sage"
                onClick={() => navigate('/transactions/deposit')}
              />
              <QuickActionCard
                title="Withdraw"
                label="Move funds out"
                tone="cream"
                onClick={() => navigate('/transactions/withdrawal')}
              />
              <QuickActionCard
                title="Transfer"
                label="Between accounts"
                tone="lavender"
                onClick={() => navigate('/transactions/transfer')}
              />
            </div>
          </section>
        )}
      </div>

      {user.role === 'ADMIN' && (
        <section className="section-block role-dashboard-panel">
          <span className="section-kicker">ADMINISTRATION</span>
          <h2>Operations workspace</h2>
          <p>Review account opening requests, manage user access, and inspect the audit trail.</p>
          <div className="role-dashboard-actions">
            <button className="button button-outline" onClick={() => navigate('/admin/onboarding')}>
              Review onboarding
            </button>
            <button className="button button-outline" onClick={() => navigate('/admin/users')}>
              Manage users
            </button>
            <button className="button button-outline" onClick={() => navigate('/audit')}>
              View audit log
            </button>
          </div>
        </section>
      )}

      {user.role === 'AUDITOR' && (
        <section className="section-block role-dashboard-panel">
          <span className="section-kicker">READ ONLY</span>
          <h2>Audit workspace</h2>
          <p>Review assigned-account statements and the audit events available to your role.</p>
          <button className="button button-outline" onClick={() => navigate('/audit')}>
            Open audit log
          </button>
        </section>
      )}

      <DashboardActivity request={request} accounts={accounts} />
    </>
  );
}
