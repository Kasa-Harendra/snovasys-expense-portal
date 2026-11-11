import React, { useEffect, useState } from 'react';
import {
  AuthedRequestFn,
  createCustomerAccount,
  fetchAccountBalance,
  fetchAccountById,
  fetchAccounts,
  formatDate,
  formatMoney,
} from '../api/client';
import { EmptyState, ErrorPanel, Icon } from '../components/Icons';
import type { Account, AccountBalance, Role } from '../types';
import { navigate } from '../utils/router';

interface BalanceEntry {
  balancePaise?: string;
  currencyCode?: string;
  error?: unknown;
}

function AccountCard({
  account,
  balance,
  selected,
  onSelect,
}: {
  account: Account;
  balance?: BalanceEntry;
  selected: boolean;
  onSelect: () => void;
}) {
  const displayBalance = balance?.error
    ? 'Unavailable'
    : balance?.balancePaise !== undefined
      ? formatMoney(balance.balancePaise, balance.currencyCode)
      : 'Loading…';

  return (
    <article className={`account-card ${selected ? 'account-card-selected' : ''}`}>
      <div className="account-card-top">
        <span className="account-symbol account-symbol-large">
          <Icon name={account.type === 'BUSINESS' ? 'building' : 'cards'} size={20} />
        </span>
        <span className={`status-pill status-${account.status.toLowerCase()}`}>
          <i />
          {account.status.toLowerCase()}
        </span>
      </div>

      <button
        className="account-card-open"
        onClick={() => navigate(`/accounts/${account.id}`)}
        aria-label={`View account ${account.accountNumber}`}
      >
        <span>{account.type === 'BUSINESS' ? 'BUSINESS ACCOUNT' : 'PERSONAL ACCOUNT'}</span>
        <strong>{account.accountNumber}</strong>
      </button>

      <div className="account-card-balance">
        <span>Available balance</span>
        <strong>{displayBalance}</strong>
      </div>

      <div className="account-card-meta">
        <span>Created {formatDate(account.createdAt)}</span>
        <span>{account.currencyCode}</span>
      </div>

      <button
        className={`account-select-button ${selected ? 'account-select-active' : ''}`}
        onClick={onSelect}
        aria-pressed={selected}
      >
        {selected ? '✓ Selected for future actions' : 'Select for future actions'}
      </button>
    </article>
  );
}

function CreateAccountForm({
  request,
  onCreated,
}: {
  request: AuthedRequestFn;
  onCreated: (account: Account) => void;
}) {
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState('PERSONAL');
  const [holderUserId, setHolderUserId] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const num = accountNumber.trim();
    const uid = holderUserId.trim();

    if (!num || num.length > 64 || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uid)) {
      setError('Enter an account number up to 64 characters and a valid account holder UUID.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await createCustomerAccount(request, {
        accountNumber: num,
        accountType,
        holderUserId: uid,
      });
      onCreated(created);
    } catch (err: any) {
      setError(
        err?.status === 409
          ? 'That account number is already in use.'
          : err?.status === 403
            ? 'Your current role cannot create accounts.'
            : err?.status === 422
              ? 'The holder must be an active account holder and the account details must be valid.'
              : err?.message || 'The account could not be created.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="create-account-form" onSubmit={handleSubmit}>
      <div className="create-form-heading">
        <div>
          <span className="section-kicker">ADMINISTRATION</span>
          <h2>Create customer account</h2>
          <p>The backend verifies your administrator role and the holder’s account status.</p>
        </div>
        <span className="admin-only-pill">
          <Icon name="shield" size={14} /> ADMIN ONLY
        </span>
      </div>

      <div className="create-form-grid">
        <label className="field-label">
          <span>Account number</span>
          <input
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            maxLength={64}
            required
            placeholder="e.g. BV-10428"
          />
        </label>
        <label className="field-label">
          <span>Account type</span>
          <select value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            <option value="PERSONAL">Personal</option>
            <option value="BUSINESS">Business</option>
          </select>
        </label>
        <label className="field-label holder-field">
          <span>Holder user ID</span>
          <input
            value={holderUserId}
            onChange={(e) => setHolderUserId(e.target.value)}
            autoComplete="off"
            required
            placeholder="Account holder UUID"
          />
        </label>
      </div>

      {error && (
        <div className="form-error" role="alert">
          <span>!</span>
          {error}
        </div>
      )}

      <div className="create-form-footer">
        <p>Account permissions are created by the server with view access only.</p>
        <button className="button button-primary" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner" />
              Creating…
            </>
          ) : (
            <>
              <Icon name="plus" size={17} />
              Create account
            </>
          )}
        </button>
      </div>
    </form>
  );
}

export function AccountsPage({
  request,
  isAdmin,
  userRole,
  accountRefreshVersion,
  refreshAccounts,
  selectedAccountId,
  setSelectedAccountId,
}: {
  request: AuthedRequestFn;
  isAdmin: boolean;
  userRole: Role;
  accountRefreshVersion: number;
  refreshAccounts: () => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [balances, setBalances] = useState<Record<string, BalanceEntry>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchAccounts(request, { signal: controller.signal })
      .then(async (list) => {
        setAccounts(list);
        if (selectedAccountId && !list.some((acc) => acc.id === selectedAccountId)) {
          setSelectedAccountId(null);
        }
        const entries = await Promise.all(
          list.map(async (acc) => {
            try {
              const bal = await fetchAccountBalance(request, acc.id, { signal: controller.signal });
              return [acc.id, { balancePaise: bal.balancePaise, currencyCode: bal.currencyCode }] as const;
            } catch (err: any) {
              if (err?.name === 'AbortError') throw err;
              return [acc.id, { error: err }] as const;
            }
          })
        );
        if (!controller.signal.aborted) {
          setBalances(Object.fromEntries(entries));
        }
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') {
          setError(
            err?.status === 403
              ? 'Your account role does not permit viewing accounts.'
              : err?.status === 401
                ? 'Your session has expired. Sign in again to continue.'
                : err?.message || 'We could not load your accounts.'
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accountRefreshVersion, request, reloadNonce, setSelectedAccountId]);

  function handleRetry() {
    setAccounts(null);
    setBalances({});
    setReloadNonce((n) => n + 1);
  }

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">YOUR SPACE</span>
          <h1>Accounts</h1>
          <p>Accounts available to your BalanceVault profile.</p>
        </div>
        <div className="account-page-actions">
          {accounts && (
            <span className="count-pill">
              {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}
            </span>
          )}
          {isAdmin && (
            <button
              className="button button-primary create-account-toggle"
              onClick={() => setShowCreateForm((prev) => !prev)}
            >
              <Icon name="plus" size={17} />
              {showCreateForm ? 'Close form' : 'New account'}
            </button>
          )}
        </div>
      </div>

      {isAdmin && showCreateForm && (
        <CreateAccountForm
          request={request}
          onCreated={(created) => {
            refreshAccounts();
            setSelectedAccountId(created.id);
            setShowCreateForm(false);
          }}
        />
      )}

      {error && <ErrorPanel message={error} onRetry={handleRetry} />}

      {loading && accounts === null ? (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading accounts
        </div>
      ) : !error && accounts?.length === 0 ? (
        <>
          <EmptyState title="No accounts available" detail="Accounts you are permitted to view will appear here." />
          {userRole === 'ACCOUNT_HOLDER' && (
            <button className="button button-outline" onClick={() => navigate('/account-requests')}>
              Request an account for review
            </button>
          )}
        </>
      ) : (
        <div className="accounts-grid">
          {accounts?.map((acc) => (
            <AccountCard
              key={acc.id}
              account={acc}
              balance={balances[acc.id]}
              selected={selectedAccountId === acc.id}
              onSelect={() => setSelectedAccountId(acc.id)}
            />
          ))}
        </div>
      )}

      {!loading && !error && accounts && accounts.length > 0 && Object.values(balances).some((b) => b.error) && (
        <p className="balance-access-note" role="status">
          Some balance details could not be loaded. Retry the page to check again.
        </p>
      )}

      {accounts && accounts.length > 0 && (
        <p className="selection-help">
          Select an account to prefill future deposit, withdrawal, and transfer forms. This selection does not grant
          access; the API checks permissions for every request.
        </p>
      )}
    </section>
  );
}

export function AccountDetailPage({
  accountId,
  request,
  selectedAccountId,
  setSelectedAccountId,
}: {
  accountId: string;
  request: AuthedRequestFn;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState<AccountBalance | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    Promise.all([
      fetchAccountById(request, accountId, { signal: controller.signal }),
      fetchAccountBalance(request, accountId, { signal: controller.signal }),
    ])
      .then(([acc, bal]) => {
        setAccount(acc);
        setBalance(bal);
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') {
          setError(
            err?.status === 401
              ? 'Your session has expired. Sign in again to continue.'
              : err?.status === 403
                ? 'You do not have permission to view this account.'
                : err?.status === 404
                  ? 'This account is unavailable or you no longer have permission to view it.'
                  : err?.message || 'We could not load this account.'
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accountId, request, reloadNonce]);

  return (
    <section className="section-block full-page-block">
      <button className="back-link" onClick={() => navigate('/accounts')}>
        ← <span>Back to accounts</span>
      </button>

      {loading ? (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading account details
        </div>
      ) : error ? (
        <ErrorPanel message={error} onRetry={() => setReloadNonce((n) => n + 1)} />
      ) : (
        account && (
          <>
            <div className="page-title-row detail-title-row">
              <div>
                <span className="section-kicker">
                  {account.type === 'BUSINESS' ? 'BUSINESS ACCOUNT' : 'PERSONAL ACCOUNT'}
                </span>
                <h1>{account.accountNumber}</h1>
                <p>Account details and current available balance.</p>
              </div>
              <span className={`status-pill status-${account.status.toLowerCase()}`}>
                <i />
                {account.status.toLowerCase()}
              </span>
            </div>

            <div className="account-detail-layout">
              <article className="detail-balance-card">
                <span className="detail-card-kicker">CURRENT BALANCE</span>
                <strong>
                  {balance ? formatMoney(balance.balancePaise, balance.currencyCode) : 'Balance unavailable'}
                </strong>
                <small>Balance supplied by the BalanceVault account API.</small>
                <div className="detail-balance-watermark" aria-hidden="true">
                  BV
                </div>
              </article>

              <article className="detail-info-card">
                <div className="detail-info-heading">
                  <span className="account-symbol account-symbol-large">
                    <Icon name={account.type === 'BUSINESS' ? 'building' : 'cards'} size={20} />
                  </span>
                  <div>
                    <span className="section-kicker">ACCOUNT INFORMATION</span>
                    <h2>Account details</h2>
                  </div>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>Account number</dt>
                    <dd>{account.accountNumber}</dd>
                  </div>
                  <div>
                    <dt>Account type</dt>
                    <dd>{account.type === 'BUSINESS' ? 'Business' : 'Personal'}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className={`status-pill status-${account.status.toLowerCase()}`}>
                        <i />
                        {account.status.toLowerCase()}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Currency</dt>
                    <dd>{account.currencyCode}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatDate(account.createdAt)}</dd>
                  </div>
                </dl>
              </article>
            </div>

            <div className="detail-selection-row">
              <div>
                <strong>Account statement</strong>
                <p>Review posted entries and refused attempts recorded for this account.</p>
              </div>
              <button
                className="button button-outline"
                onClick={() => {
                  setSelectedAccountId(account.id);
                  navigate('/statements');
                }}
              >
                View statements
              </button>
              <button
                className={`button ${selectedAccountId === account.id ? 'button-selected' : 'button-outline'}`}
                onClick={() => setSelectedAccountId(account.id)}
              >
                {selectedAccountId === account.id ? 'Selected for future actions' : 'Select this account'}
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}
