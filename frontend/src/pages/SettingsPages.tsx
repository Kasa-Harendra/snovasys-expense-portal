import React, { useEffect, useState } from 'react';
import { AuthedRequestFn, formatDateTime, ROLE_LABELS } from '../api/client';
import type { User } from '../types';
import { navigate } from '../utils/router';

export function ProfilePage({
  request,
  user,
  updateUser,
}: {
  request: AuthedRequestFn;
  user: User;
  updateUser: (patch: Partial<User>) => void;
}) {
  const [profile, setProfile] = useState<User | null>(null);
  const [fullName, setFullName] = useState(user.fullName ?? '');
  const [successMsg, setSuccessMsg] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadProfile() {
    setError('');
    try {
      const res = await request<{ user: User }>('/api/users/me');
      setProfile(res.user);
      setFullName(res.user.fullName ?? '');
    } catch (err: any) {
      setError(err?.message || 'Profile could not be loaded.');
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await request<{ user: User }>('/api/users/me', {
        method: 'PATCH',
        body: { fullName: fullName.trim() },
      });
      setProfile(res.user);
      updateUser(res.user);
      setSuccessMsg('Profile updated.');
    } catch (err: any) {
      setError(err?.message || 'Profile could not be updated.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">YOUR ACCOUNT</span>
          <h1>Profile</h1>
          <p>Review and update your personal details.</p>
        </div>
      </div>

      {!profile && !error && (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading profile
        </div>
      )}

      {error && (
        <div className="form-error" role="alert">
          {error}
          <button type="button" onClick={loadProfile}>
            Retry
          </button>
        </div>
      )}

      {profile && (
        <form className="settings-card settings-form" onSubmit={handleSave}>
          <label className="field-label">
            <span>Full name</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              minLength={1}
              maxLength={100}
              required
            />
          </label>
          <label className="field-label">
            <span>Email</span>
            <input value={profile.email} readOnly />
          </label>
          <label className="field-label">
            <span>Role</span>
            <input value={ROLE_LABELS[profile.role] ?? profile.role} readOnly />
          </label>
          <label className="field-label">
            <span>Account status</span>
            <input value={profile.isActive ? 'Active' : 'Inactive'} readOnly />
          </label>
          <label className="field-label">
            <span>Member since</span>
            <input value={profile.createdAt ? formatDateTime(profile.createdAt) : '—'} readOnly />
          </label>
          {successMsg && (
            <p className="form-success" role="status">
              {successMsg}
            </p>
          )}
          <button className="button button-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            className="button button-outline"
            type="button"
            onClick={() => navigate('/settings/security')}
          >
            Security settings
          </button>
        </form>
      )}
    </section>
  );
}

export function SecurityPage({
  request,
  onChanged,
}: {
  request: AuthedRequestFn;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await request('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Password could not be changed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="section-block full-page-block">
      <div className="page-title-row">
        <div>
          <span className="section-kicker">ACCOUNT SECURITY</span>
          <h1>Security</h1>
          <p>Changing your password signs out existing sessions.</p>
        </div>
      </div>

      <form className="settings-card settings-form" onSubmit={handleSubmit}>
        <label className="field-label">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="field-label">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={72}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button className="button button-primary" disabled={submitting}>
          {submitting ? 'Updating…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
