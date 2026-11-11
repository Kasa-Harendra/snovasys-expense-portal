import React, { useEffect, useState } from 'react';
import { AuthedRequestFn, formatDateTime, ROLE_LABELS } from '../api/client';
import { EmptyState } from '../components/Icons';
import type { AccountRequestItem, InvitationItem, Role, User } from '../types';

export function AdminUsersPage({ request }: { request: AuthedRequestFn }) {
  const [usersData, setUsersData] = useState<{ users: User[]; total: number } | null>(null);
  const [invitations, setInvitations] = useState<InvitationItem[] | null>(null);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('AUDITOR');

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [creatingInvite, setCreatingInvite] = useState(false);
  const [createdInvitation, setCreatedInvitation] = useState<InvitationItem | null>(null);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: '1',
      perPage: '50',
      ...(search ? { search } : {}),
      ...(roleFilter ? { role: roleFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    });

    Promise.all([
      request<{ users: User[]; total: number }>(`/api/admin/users?${params}`, { signal: controller.signal }),
      request<{ invitations: InvitationItem[] }>('/api/admin/invitations', { signal: controller.signal }),
    ])
      .then(([usersRes, invitesRes]) => {
        setUsersData(usersRes);
        setInvitations(invitesRes.invitations);
        setError('');
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(err?.message || 'Unable to load admin data.');
      });

    return () => controller.abort();
  }, [request, reloadNonce, search, roleFilter, statusFilter]);

  async function toggleUserStatus(user: User) {
    setError('');
    try {
      await request(`/api/admin/users/${user.id}/status`, {
        method: 'PATCH',
        body: { isActive: !user.isActive },
      });
      setReloadNonce((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || 'User status could not be changed.');
    }
  }

  async function handleCreateInvitation(e: React.FormEvent) {
    e.preventDefault();
    setCreatingInvite(true);
    setError('');
    setStatusMsg('');
    setCreatedInvitation(null);

    try {
      const res = await request<{ invitation: InvitationItem }>('/api/admin/invitations', {
        method: 'POST',
        body: { fullName: inviteName, email: inviteEmail, role: inviteRole },
      });
      setCreatedInvitation(res.invitation);
      setInviteName('');
      setInviteEmail('');
      setReloadNonce((n) => n + 1);
      setStatusMsg('Invitation created. Copy its link now; the token is shown only once.');
    } catch (err: any) {
      setError(err?.message || 'Invitation could not be created.');
    } finally {
      setCreatingInvite(false);
    }
  }

  async function handleRevokeInvitation(inv: InvitationItem) {
    setError('');
    setStatusMsg('');
    try {
      await request(`/api/admin/invitations/${inv.id}/revoke`, {
        method: 'POST',
        body: {},
      });
      setReloadNonce((n) => n + 1);
      setStatusMsg('Invitation revoked.');
    } catch (err: any) {
      setError(err?.message || 'Invitation could not be revoked.');
    }
  }

  const invitationLink = createdInvitation?.token
    ? `${window.location.origin}/accept-invitation#${createdInvitation.token}`
    : '';

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">ADMINISTRATION</span>
          <h1>User management</h1>
          <p>Customers register publicly; privileged roles require an administrator invitation.</p>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
          <button onClick={() => setReloadNonce((n) => n + 1)}>Retry</button>
        </div>
      )}

      {statusMsg && (
        <p className="form-success" role="status">
          {statusMsg}
        </p>
      )}

      <form className="settings-card settings-form" onSubmit={handleCreateInvitation}>
        <h2>Invite an administrator or auditor</h2>
        <label className="field-label">
          <span>Full name</span>
          <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} maxLength={100} required />
        </label>
        <label className="field-label">
          <span>Email</span>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            maxLength={254}
            required
          />
        </label>
        <label className="field-label">
          <span>Role</span>
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
            <option value="AUDITOR">Auditor</option>
            <option value="ADMIN">Administrator</option>
          </select>
        </label>
        <button className="button button-primary" disabled={creatingInvite}>
          {creatingInvite ? 'Creating invitation…' : 'Create invitation'}
        </button>
      </form>

      {createdInvitation && (
        <div className="settings-card invitation-link-panel">
          <strong>Share this invitation link securely</strong>
          <p>This link expires {formatDateTime(createdInvitation.expiresAt)} and can be accepted once.</p>
          <input
            aria-label="One-time invitation link"
            readOnly
            value={invitationLink}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="button button-outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invitationLink);
                setStatusMsg('Invitation link copied.');
              } catch {
                setStatusMsg('Select and copy the invitation link.');
              }
            }}
          >
            Copy link
          </button>
        </div>
      )}

      <h2 className="ledger-subheading">Users</h2>

      <div className="admin-filter-row">
        <label className="field-label">
          <span>Search name or email</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} maxLength={100} />
        </label>
        <label className="field-label">
          <span>Role</span>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            <option value="ACCOUNT_HOLDER">Account holder</option>
            <option value="ADMIN">Administrator</option>
            <option value="AUDITOR">Auditor</option>
          </select>
        </label>
        <label className="field-label">
          <span>Status</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
      </div>

      {!usersData && !error && <div className="loading-row">Loading users…</div>}

      {usersData?.users.length === 0 && (
        <EmptyState title="No users found" detail="Try a different search or filter." />
      )}

      {usersData?.users.map((u) => (
        <article key={u.id} className="admin-list-row settings-card">
          <div>
            <strong>{u.fullName || u.email}</strong>
            <small>
              {u.email} · {ROLE_LABELS[u.role]} · Joined {u.createdAt ? formatDateTime(u.createdAt) : '—'}
            </small>
          </div>
          <span className={`status-pill status-${u.isActive ? 'active' : 'closed'}`}>
            {u.isActive ? 'Active' : 'Inactive'}
          </span>
          {u.role !== 'ADMIN' && (
            <button className="button button-outline" onClick={() => toggleUserStatus(u)}>
              {u.isActive ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </article>
      ))}

      <h2 className="ledger-subheading">Invitations</h2>

      {!invitations && !error && <div className="loading-row">Loading invitations…</div>}

      {invitations?.length === 0 && (
        <EmptyState title="No invitations" detail="Invitations you create will appear here." />
      )}

      {invitations?.map((inv) => {
        const badgeLabel = inv.acceptedAt
          ? 'Accepted'
          : inv.revokedAt
            ? 'Revoked'
            : new Date(inv.expiresAt) <= new Date()
              ? 'Expired'
              : 'Pending';

        return (
          <article key={inv.id} className="admin-list-row settings-card">
            <div>
              <strong>
                {inv.fullName} · {ROLE_LABELS[inv.role]}
              </strong>
              <small>
                {inv.email} · Expires {formatDateTime(inv.expiresAt)}
              </small>
            </div>
            <span className={`status-pill status-${badgeLabel.toLowerCase()}`}>{badgeLabel}</span>
            {badgeLabel === 'Pending' && (
              <button className="button button-outline" onClick={() => handleRevokeInvitation(inv)}>
                Revoke
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function AdminOnboardingPage({
  request,
  refreshAccounts,
}: {
  request: AuthedRequestFn;
  refreshAccounts: () => void;
}) {
  const [queue, setQueue] = useState<AccountRequestItem[] | null>(null);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [accountNumbers, setAccountNumbers] = useState<Record<string, string>>({});

  useEffect(() => {
    const controller = new AbortController();
    request<{ requests: AccountRequestItem[] }>('/api/account-requests/admin/queue', {
      signal: controller.signal,
    })
      .then((res) => setQueue(res.requests))
      .catch((err: any) => {
        if (err?.name !== 'AbortError') setError(err?.message || 'Unable to load onboarding queue.');
      });

    return () => controller.abort();
  }, [request, reloadNonce]);

  async function resolveRequest(reqItem: AccountRequestItem, action: 'approve' | 'reject') {
    setError('');
    try {
      if (action === 'approve') {
        const num = accountNumbers[reqItem.id]?.trim();
        if (!num) {
          setError('Enter an account number before approval.');
          return;
        }
        await request(`/api/account-requests/admin/${reqItem.id}/approve`, {
          method: 'POST',
          body: { accountNumber: num },
        });
        refreshAccounts();
      } else {
        await request(`/api/account-requests/admin/${reqItem.id}/reject`, {
          method: 'POST',
          body: { note: 'Reviewed by administrator' },
        });
      }
      setReloadNonce((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || 'The request could not be resolved.');
    }
  }

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">ADMINISTRATION</span>
          <h1>Account onboarding</h1>
          <p>Approved accounts are created atomically with view permission for the requester.</p>
        </div>
      </div>

      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}

      {!queue && !error && <div className="loading-row">Loading requests…</div>}

      {queue?.length === 0 && (
        <EmptyState title="No requests awaiting review" detail="Pending customer requests will appear here." />
      )}

      {queue?.map((reqItem) => (
        <article key={reqItem.id} className="settings-card onboarding-row">
          <div>
            <strong>{reqItem.user?.fullName || reqItem.user?.email}</strong>
            <small>
              {reqItem.user?.email} · {reqItem.requestedType} · {formatDateTime(reqItem.createdAt)}
            </small>
          </div>
          <label className="field-label">
            <span>Account number</span>
            <input
              value={accountNumbers[reqItem.id] ?? ''}
              onChange={(e) => setAccountNumbers((prev) => ({ ...prev, [reqItem.id]: e.target.value }))}
              maxLength={64}
            />
          </label>
          <div className="role-dashboard-actions">
            <button className="button button-primary" onClick={() => resolveRequest(reqItem, 'approve')}>
              Approve and open
            </button>
            <button className="button button-outline" onClick={() => resolveRequest(reqItem, 'reject')}>
              Reject
            </button>
          </div>
        </article>
      ))}
    </section>
  );
}
