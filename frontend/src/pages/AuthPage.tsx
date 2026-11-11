import React, { useState } from 'react';
import { ApiError } from '../api/client';
import { Brand, Icon, PasswordInput } from '../components/Icons';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../utils/router';

export function AuthPage({ mode }: { mode: 'login' | 'register' | 'invitation' }) {
  const isRegister = mode === 'register';
  const isInvitation = mode === 'invitation';
  const { login, register, acceptInvitation } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if ((isRegister || isInvitation) && password.length < 12) {
      setError('Use a password with at least 12 characters.');
      return;
    }

    if ((isRegister || isInvitation) && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register({ name: fullName, email, password });
      } else if (isInvitation) {
        const token = window.location.hash.slice(1);
        if (!token) {
          throw new Error('Invitation token is missing. Open the complete invitation link.');
        }
        await acceptInvitation({ token, password });
      } else {
        await login({ email, password });
      }
      setPassword('');
      setConfirmPassword('');
      navigate('/dashboard', true);
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : err?.message || 'We could not sign you in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="BalanceVault introduction">
        <div className="auth-story-top">
          <Brand inverse />
          <span className="story-status">
            <i /> Secure ledger platform
          </span>
        </div>

        <div className="story-copy">
          <p className="eyebrow">Money, accounted for.</p>
          <h1>
            Confidence in every
            <br />
            <em>transaction.</em>
          </h1>
          <p className="story-description">
            A clearer view of your accounts, built on a ledger where every entry has its place.
          </p>
        </div>

        <div className="ledger-art" aria-hidden="true">
          <div className="ledger-orbit orbit-one" />
          <div className="ledger-orbit orbit-two" />
          <div className="ledger-card">
            <div className="ledger-card-top">
              <span>BV / PRIVATE LEDGER</span>
              <span className="ledger-dot" />
            </div>
            <div className="ledger-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="ledger-card-foot">
              <span>SECURE BY DESIGN</span>
              <Icon name="shield" size={20} />
            </div>
          </div>
          <div className="ledger-chip chip-top">
            01 <span>Verified access</span>
          </div>
          <div className="ledger-chip chip-bottom">
            <span className="chip-check">✓</span> Every entry accountable
          </div>
        </div>

        <div className="story-footer">
          <span>Private by design</span>
          <span>Built around financial integrity</span>
        </div>
      </section>

      <section className="auth-form-side">
        <div className="auth-mobile-brand">
          <Brand />
        </div>

        <div className="auth-form-card">
          <div className="form-heading">
            <span className="form-kicker">
              {isRegister ? 'GET STARTED' : isInvitation ? 'SECURE INVITATION' : 'WELCOME BACK'}
            </span>
            <h2>
              {isRegister ? 'Create your account' : isInvitation ? 'Set your password' : 'Sign in to your vault'}
            </h2>
            <p>
              {isRegister
                ? 'Set up your secure account in a few steps.'
                : isInvitation
                  ? 'Choose a password to activate your invited BalanceVault role.'
                  : 'Your accounts, clearly in view.'}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {isRegister && (
              <label className="field-label">
                <span>Full name</span>
                <input
                  required
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                  maxLength={100}
                  placeholder="Your name"
                />
              </label>
            )}

            {!isInvitation && (
              <label className="field-label">
                <span>Email address</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  maxLength={254}
                  placeholder="you@example.com"
                />
              </label>
            )}

            {!isInvitation && (
              <PasswordInput
                value={password}
                onChange={setPassword}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                hint={isRegister ? 'Use 12 or more characters.' : null}
              />
            )}

            {isInvitation && (
              <PasswordInput
                label="New password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                hint="Use 12 or more characters."
              />
            )}

            {(isRegister || isInvitation) && (
              <PasswordInput
                label="Confirm password"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                hint={null}
              />
            )}

            {error && (
              <div className="form-error" role="alert">
                <span>!</span>
                {error}
              </div>
            )}

            <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" />
                  {isRegister ? 'Creating account…' : isInvitation ? 'Accepting invitation…' : 'Signing in…'}
                </>
              ) : (
                <>
                  {isRegister ? 'Create account' : isInvitation ? 'Accept invitation' : 'Sign in'}
                  <Icon name="arrow" size={18} />
                </>
              )}
            </button>
          </form>

          {!isInvitation && (
            <p className="auth-switch">
              {isRegister ? 'Already have an account?' : 'New to BalanceVault?'}{' '}
              <button type="button" onClick={() => navigate(isRegister ? '/login' : '/register')}>
                {isRegister ? 'Sign in' : 'Create an account'}
              </button>
            </p>
          )}

          <div className="secure-note">
            <Icon name="lock" size={15} />
            <span>
              Your connection is protected. We never display or store your password in the browser after signing in.
            </span>
          </div>
        </div>

        <p className="auth-legal">BalanceVault · Secure financial ledger</p>
      </section>
    </main>
  );
}
