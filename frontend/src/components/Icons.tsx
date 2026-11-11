import React, { useState } from 'react';
import { navigate } from '../utils/router';

export type IconName =
  | 'grid'
  | 'cards'
  | 'activity'
  | 'shield'
  | 'arrow'
  | 'logout'
  | 'eye'
  | 'eyeOff'
  | 'plus'
  | 'lock'
  | 'building';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const svgProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  const icons: Record<IconName, React.ReactNode> = {
    grid: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
      </>
    ),
    cards: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <path d="M3 10h18M7 15h3" />
      </>
    ),
    activity: <path d="M3 12h4l2.3-6 4.4 12 2.3-6H21" />,
    shield: (
      <>
        <path d="M12 3 20 6v5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6l8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    logout: (
      <>
        <path d="M10 17l5-5-5-5M15 12H3" />
        <path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
      </>
    ),
    eye: (
      <>
        <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z" />
        <circle cx="12" cy="12" r="2.5" />
      </>
    ),
    eyeOff: (
      <>
        <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
        <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.2 0 9.5 7 9.5 7a15 15 0 0 1-2.6 3.4M6.2 6.2C3.8 7.8 2.5 12 2.5 12s3.3 7 9.5 7c1.2 0 2.2-.2 3.1-.6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    building: <path d="M4 21V5l8-3 8 3v16M2 21h20M8 8h1m6 0h1M8 12h1m6 0h1M10 21v-5h4v5" />,
  };

  return <svg {...svgProps}>{icons[name] ?? icons.grid}</svg>;
}

export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <a
      href="/dashboard"
      onClick={(e) => {
        e.preventDefault();
        navigate('/dashboard');
      }}
      className={`brand ${inverse ? 'brand-inverse' : ''}`}
      aria-label="BalanceVault dashboard"
    >
      <span className="brand-mark">
        b<span>.</span>
      </span>
      <span className="brand-word">balancevault</span>
    </a>
  );
}

export function PasswordInput({
  label = 'Password',
  value,
  onChange,
  autoComplete = 'current-password',
  hint,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  hint?: string | null;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <label className="field-label">
      <span>{label}</span>
      <span className="password-input-wrap">
        <input
          required
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? 12 : 1}
          maxLength={72}
          placeholder={autoComplete === 'new-password' ? 'At least 12 characters' : 'Enter your password'}
        />
        <button
          className="password-toggle"
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={18} />
        </button>
      </span>
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

export function EmptyState({
  title,
  detail,
  icon = 'cards',
}: {
  title: string;
  detail: string;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={20} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="account-error-panel" role="alert">
      <span className="error-mark">!</span>
      <div>
        <strong>We couldn’t load the account information</strong>
        <p>{message}</p>
      </div>
      <button className="button button-outline" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
