import React, { useEffect, useState } from 'react';
import { AuthedRequestFn, formatDateTime } from '../api/client';
import { EmptyState } from '../components/Icons';
import type { AccountRequestItem } from '../types';

export function AccountRequestsPage({ request }: { request: AuthedRequestFn }) {
  const [requests, setRequests] = useState<AccountRequestItem[] | null>(null);
  const [requestedType, setRequestedType] = useState('PERSONAL');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    request<{ requests: AccountRequestItem[] }>('/api/account-requests', { signal: controller.signal })
      .then((res) => setRequests(res.requests))
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(err?.message || 'Unable to load requests.');
      });
    return () => controller.abort();
  }, [request, reloadNonce]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await request('/api/account-requests', {
        method: 'POST',
        body: { requestedType },
      });
      setReloadNonce((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || 'Request could not be submitted.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">ONBOARDING</span>
          <h1>Account request</h1>
          <p>Customer accounts are opened after administrator review.</p>
        </div>
      </div>

      <form className="settings-card onboarding-request-form" onSubmit={handleSubmit}>
        <label className="field-label">
          <span>Requested account type</span>
          <select value={requestedType} onChange={(e) => setRequestedType(e.target.value)}>
            <option value="PERSONAL">Personal</option>
            <option value="BUSINESS">Business</option>
          </select>
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button button-primary" disabled={submitting}>
          {submitting ? 'Submitting…' : 'Submit request'}
        </button>
      </form>

      <h2 className="ledger-subheading">Your requests</h2>

      {requests === null ? (
        <div className="loading-row">Loading requests…</div>
      ) : requests.length === 0 ? (
        <EmptyState title="No requests yet" detail="Submitted account requests and their decisions appear here." />
      ) : (
        <div className="settings-card">
          {requests.map((reqItem) => (
            <div key={reqItem.id} className="admin-list-row">
              <strong>{reqItem.requestedType} account</strong>
              <span className={`status-pill status-${reqItem.status.toLowerCase()}`}>{reqItem.status}</span>
              <small>{formatDateTime(reqItem.createdAt)}</small>
              {reqItem.reviewNote && <p>{reqItem.reviewNote}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
