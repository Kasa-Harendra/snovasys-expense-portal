import React, { useEffect, useState } from 'react';
import {
  AuthedRequestFn,
  fetchAccounts,
  fetchAccountStatement,
  fetchAuditLogs,
  fetchTransferDetails,
  formatDateTime,
  formatMoney,
  getEventDirection,
} from '../api/client';
import type {
  Account,
  AuditResponse,
  StatementEventItem,
  TransferDetail,
} from '../types';

function formatLedgerError(err: any, context: 'statement' | 'transfer' | 'audit'): string {
  if (err?.status === 401) return 'Your session has expired. Sign in again to continue.';
  if (err?.status === 403) {
    return context === 'audit'
      ? 'Your current role cannot view audit records.'
      : 'You do not have permission to view this account.';
  }
  if (err?.status === 404) return 'This record is unavailable or you no longer have permission to view it.';
  return err?.message || 'The request could not be completed. Please retry.';
}

export function StatementEventRow({
  event,
  currencyCode = 'INR',
  compact = false,
}: {
  event: StatementEventItem;
  currencyCode?: string;
  compact?: boolean;
}) {
  const isPosted = event.status === 'POSTED';
  const direction = getEventDirection(event);
  const typeLabel = event.type[0] + event.type.slice(1).toLowerCase();

  return (
    <article className={`statement-event ${compact ? 'statement-event-compact' : ''}`}>
      <span className={`statement-event-mark ${isPosted ? 'event-posted' : 'event-refused'}`} aria-hidden="true">
        {isPosted ? (direction === 'Credit' ? '↓' : '↑') : '!'}
      </span>

      <div className="statement-event-main">
        <div className="statement-event-title">
          <strong>{typeLabel}</strong>
          <span className={`event-status ${isPosted ? 'event-status-posted' : 'event-status-refused'}`}>
            {event.status}
          </span>
        </div>
        <span className="statement-event-meta">
          {formatDateTime(event.timestamp)}
          {event.reference ? ` · Ref ${event.reference}` : ''}
        </span>
        {!compact && (
          <div className="statement-event-extra">
            <span>{direction}</span>
            <span>Actor role: {event.actor?.role ?? 'Unavailable'}</span>
            {event.refusalReason && <span>Reason: {event.refusalReason.replaceAll('_', ' ')}</span>}
          </div>
        )}
      </div>

      <div className="statement-event-values">
        <strong className={isPosted && direction === 'Debit' ? 'amount-debit' : isPosted ? 'amount-credit' : ''}>
          {formatMoney(event.amountPaise, currencyCode)}
        </strong>
        <span>
          {isPosted
            ? `Balance ${formatMoney(event.runningBalancePaise, currencyCode)}`
            : `Balance unchanged · ${formatMoney(event.runningBalancePaise, currencyCode)}`}
        </span>
      </div>
    </article>
  );
}

export function StatementPage({
  request,
  selectedAccountId,
  setSelectedAccountId,
}: {
  request: AuthedRequestFn;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
}) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState('');
  const [events, setEvents] = useState<StatementEventItem[]>([]);
  const [accountMeta, setAccountMeta] = useState<{
    id: string;
    accountNumber: string;
    type: string;
    currencyCode: string;
  } | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    fetchAccounts(request, { signal: controller.signal })
      .then((list) => {
        setAccounts(list);
        const preferred = list.some((acc) => acc.id === selectedAccountId)
          ? (selectedAccountId as string)
          : list[0]?.id ?? '';
        setAccountId((prev) => (list.some((acc) => acc.id === prev) ? prev : preferred));
        if (preferred) setSelectedAccountId(preferred);
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(formatLedgerError(err, 'statement'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [request, reloadNonce, selectedAccountId, setSelectedAccountId]);

  useEffect(() => {
    if (!accountId) {
      setEvents([]);
      setAccountMeta(null);
      setNextCursor(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError('');
    setEvents([]);
    setNextCursor(null);

    fetchAccountStatement(request, accountId, { signal: controller.signal, limit: 25 })
      .then((res) => {
        setAccountMeta(res.account);
        setEvents(res.events);
        setNextCursor(res.nextCursor ?? null);
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(formatLedgerError(err, 'statement'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accountId, request, reloadNonce]);

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const res = await fetchAccountStatement(request, accountId, { limit: 25, cursor: nextCursor });
      setEvents((prev) => [...prev, ...res.events]);
      setNextCursor(res.nextCursor ?? null);
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(formatLedgerError(err, 'statement'));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="section-block full-page-block ledger-page">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">LEDGER</span>
          <h1>Account statements</h1>
          <p>Posted entries and recorded refusals in the order supplied by the ledger.</p>
        </div>
      </div>

      {accounts && accounts.length > 0 && (
        <label className="statement-account-select">
          <span>Choose account</span>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setSelectedAccountId(e.target.value);
            }}
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.accountNumber} · {acc.type} · {acc.currencyCode}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <div className="ledger-error" role="alert">
          <span>{error}</span>
          <button className="button button-outline" onClick={() => setReloadNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading statement
        </div>
      )}

      {!loading && !error && accounts?.length === 0 && (
        <div className="empty-state">
          <strong>No accounts available</strong>
          <p>Statements are available for accounts you can view.</p>
        </div>
      )}

      {!loading && !error && accountMeta && (
        <>
          <div className="statement-account-summary">
            <div>
              <span className="section-kicker">{accountMeta.type}</span>
              <strong>{accountMeta.accountNumber}</strong>
            </div>
            <span>{accountMeta.currencyCode}</span>
          </div>

          {events.length === 0 ? (
            <div className="empty-state">
              <strong>No statement events</strong>
              <p>Posted entries and refused attempts will appear here.</p>
            </div>
          ) : (
            <div className="statement-list">
              {events.map((ev) => (
                <StatementEventRow
                  key={`${ev.status}:${ev.id}`}
                  event={ev}
                  currencyCode={accountMeta.currencyCode}
                />
              ))}
            </div>
          )}

          {nextCursor && (
            <div className="ledger-load-more">
              <button className="button button-outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <span className="spinner spinner-dark" />
                    Loading more…
                  </>
                ) : (
                  'Load more'
                )}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function TransferDetailsPage({
  request,
  transferId,
  onNavigate,
}: {
  request: AuthedRequestFn;
  transferId: string;
  onNavigate: (path: string) => void;
}) {
  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setTransfer(null);
    fetchTransferDetails(request, transferId, { signal: controller.signal })
      .then(setTransfer)
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(formatLedgerError(err, 'transfer'));
      });
    return () => controller.abort();
  }, [request, transferId, reloadNonce]);

  const debitEntry = transfer?.entries.find((entry) => BigInt(entry.amountPaise) < 0n);

  return (
    <section className="section-block full-page-block ledger-page">
      <button className="back-link" onClick={() => onNavigate('/statements')}>
        ← <span>Back to statements</span>
      </button>

      <div className="page-title-row">
        <div>
          <span className="section-kicker">TRANSFER DETAILS</span>
          <h1>Transfer</h1>
          <p>Details returned by the BalanceVault transfer API.</p>
        </div>
      </div>

      {error && (
        <div className="ledger-error" role="alert">
          <span>{error}</span>
          <button className="button button-outline" onClick={() => setReloadNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {!transfer && !error && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading transfer
        </div>
      )}

      {transfer && (
        <>
          <div className="transfer-detail-summary">
            <div>
              <span>Transaction ID</span>
              <strong className="break-id">{transfer.id}</strong>
            </div>
            <div>
              <span>Type</span>
              <strong>{transfer.type || 'TRANSFER'}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong className="event-status event-status-posted">{transfer.status}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>
                {debitEntry
                  ? formatMoney(BigInt(debitEntry.amountPaise) * -1n, debitEntry.account.currencyCode)
                  : transfer.amountPaise
                    ? formatMoney(transfer.amountPaise, 'INR')
                    : 'Unavailable'}
              </strong>
            </div>
            <div>
              <span>Created</span>
              <strong>{formatDateTime(transfer.createdAt)}</strong>
            </div>
          </div>

          <h2 className="ledger-subheading">Account entries</h2>
          <div className="transfer-entry-list">
            {transfer.entries.map((entry) => (
              <article key={entry.account.id}>
                <div>
                  <strong>{entry.account.accountNumber}</strong>
                  <span>
                    {entry.account.type} · {entry.account.currencyCode}
                  </span>
                </div>
                <strong>{formatMoney(entry.amountPaise, entry.account.currencyCode)}</strong>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function AuditPage({ request }: { request: AuthedRequestFn }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    fetchAuditLogs(request, page, 25, { signal: controller.signal })
      .then(setData)
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(formatLedgerError(err, 'audit'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, request, reloadNonce]);

  return (
    <section className="section-block full-page-block ledger-page">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">ADMINISTRATION</span>
          <h1>Audit log</h1>
          <p>Recorded actions with sensitive metadata redacted by the backend.</p>
        </div>
      </div>

      {error && (
        <div className="ledger-error" role="alert">
          <span>{error}</span>
          <button className="button button-outline" onClick={() => setReloadNonce((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {loading && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading audit events
        </div>
      )}

      {!loading && !error && data?.events.length === 0 && (
        <div className="empty-state">
          <strong>No audit events yet</strong>
          <p>Recorded actions will appear here.</p>
        </div>
      )}

      {!loading && !error && data && data.events.length > 0 && (
        <>
          <div className="audit-list">
            {data.events.map((ev) => (
              <article key={ev.id} className="audit-row audit-row-detailed">
                <span className="audit-icon" aria-hidden="true">
                  ↗
                </span>
                <div className="audit-main">
                  <strong>{ev.action.replaceAll('_', ' ').toLowerCase()}</strong>
                  <span>
                    {ev.entityType} · {ev.actor.email} · {ev.actor.role}
                  </span>
                  <small className="audit-entity-id">Entity ID: {ev.entityId}</small>
                  {ev.metadata != null && (
                    <pre className="audit-metadata">{JSON.stringify(ev.metadata, null, 2)}</pre>
                  )}
                </div>
                <time dateTime={ev.createdAt}>{formatDateTime(ev.createdAt)}</time>
              </article>
            ))}
          </div>

          <div className="audit-pagination">
            <button
              className="button button-outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <span>Page {data.page}</span>
            <button
              className="button button-outline"
              disabled={!data.hasMore}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
