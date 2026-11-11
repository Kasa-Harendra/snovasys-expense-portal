import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  fetchAccountBalance,
  fetchAccounts,
  formatMoney,
} from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Account } from '../types';

type TransactionMode = 'deposit' | 'withdrawal' | 'transfer';
type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';

interface TransactionPayload {
  type: TransactionType;
  accountId?: string;
  sourceAccountId?: string;
  destinationAccountId?: string;
  amountPaise: string;
}

interface PendingAttempt {
  idempotencyKey: string;
  payload: TransactionPayload;
  payloadKey: string;
  state: 'review' | 'uncertain' | 'conflict';
}

interface TransactionOutcome {
  kind: 'posted' | 'refused' | 'uncertain' | 'conflict' | 'error';
  result?: any;
  payload?: TransactionPayload;
  reason?: string;
  message?: string;
  httpStatus?: number;
}

const MAX_SAFE_PAISE = BigInt(Number.MAX_SAFE_INTEGER);
const AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const UUID_REGEX = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function parseInrToPaise(input: string): string {
  const trimmed = String(input).trim();
  if (!trimmed || trimmed.length > 24 || !AMOUNT_REGEX.test(trimmed)) {
    throw new Error('Enter a valid INR amount with no more than two decimal places.');
  }
  const [whole, frac = ''] = trimmed.split('.');
  const paise = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  if (paise <= 0n) {
    throw new Error('Amount must be greater than ₹0.00.');
  }
  if (paise > MAX_SAFE_PAISE) {
    throw new Error('Amount exceeds the supported transaction limit.');
  }
  return paise.toString();
}

function paiseToInrInput(paise: string): string {
  const val = BigInt(paise);
  const neg = val < 0n;
  const abs = neg ? -val : val;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

function getPayloadKey(payload: TransactionPayload): string {
  return JSON.stringify([
    payload.type,
    payload.accountId ?? null,
    payload.sourceAccountId ?? null,
    payload.destinationAccountId ?? null,
    String(payload.amountPaise),
  ]);
}

function pendingStorageKey(userId: string, type: TransactionType): string {
  return `balancevault.pending-transaction.v1:${userId}:${type}`;
}

function loadPendingAttempt(userId: string, type: TransactionType): PendingAttempt | null {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingStorageKey(userId, type)) || 'null');
    if (
      !raw ||
      !UUID_REGEX.test(raw.idempotencyKey ?? '') ||
      !raw.payload ||
      raw.payload.type !== type ||
      !/^\d+$/.test(String(raw.payload.amountPaise ?? '')) ||
      !['review', 'uncertain', 'conflict'].includes(raw.state)
    ) {
      return null;
    }
    return raw as PendingAttempt;
  } catch {
    return null;
  }
}

function savePendingAttempt(userId: string, type: TransactionType, attempt: PendingAttempt): void {
  localStorage.setItem(pendingStorageKey(userId, type), JSON.stringify(attempt));
}

function clearPendingAttempt(userId: string, type: TransactionType): boolean {
  try {
    localStorage.removeItem(pendingStorageKey(userId, type));
    return true;
  } catch {
    return false;
  }
}

function mapTransactionError(err: any): string {
  const reason = err?.payload?.reason as string | undefined;
  const messages: Record<string, string> = {
    insufficient_funds: 'The account does not have enough available funds for this withdrawal or transfer.',
    not_authorized: 'You do not have permission to perform this operation on the selected account.',
    role_forbidden: 'Your current role cannot initiate money movement.',
    account_unavailable: 'One of the selected accounts is unavailable for transactions.',
    account_inactive: 'Your user account is inactive. Sign in again or contact an administrator.',
    invalid_accounts: 'The selected account combination is not valid for this transaction.',
    clearing_account_unavailable: 'The transaction service is temporarily unavailable. No funds were moved.',
  };
  return (reason && messages[reason]) ?? err?.message ?? 'The transaction could not be completed.';
}

const MODE_CONFIG: Record<
  TransactionMode,
  { type: TransactionType; title: string; verb: string; endpoint: string; intro: string }
> = {
  deposit: {
    type: 'DEPOSIT',
    title: 'Deposit',
    verb: 'deposit',
    endpoint: '/api/deposits',
    intro: 'Add funds to an eligible account.',
  },
  withdrawal: {
    type: 'WITHDRAWAL',
    title: 'Withdrawal',
    verb: 'withdraw',
    endpoint: '/api/withdrawals',
    intro: 'Move funds from an eligible account.',
  },
  transfer: {
    type: 'TRANSFER',
    title: 'Transfer',
    verb: 'transfer',
    endpoint: '/api/transfers',
    intro: 'Move funds between two of your accessible accounts.',
  },
};

function ReviewParty({ label, account }: { label: string; account?: Account }) {
  return (
    <div className="review-party">
      <span>{label}</span>
      <strong>{account?.accountNumber ?? 'Selected account'}</strong>
      <small>{account ? `${account.type} · ${account.currencyCode}` : 'Account details unavailable'}</small>
    </div>
  );
}

function formatReceiptAccounts(payload: TransactionPayload | undefined, accounts: Account[]): string {
  const srcId = payload?.sourceAccountId ?? payload?.accountId;
  const destId = payload?.destinationAccountId;
  const srcNum = accounts.find((a) => a.id === srcId)?.accountNumber ?? 'Account';
  if (!destId) return srcNum;
  const destNum = accounts.find((a) => a.id === destId)?.accountNumber ?? 'Account';
  return `${srcNum} → ${destNum}`;
}

function TransactionResult({
  outcome,
  attempt,
  submitting,
  onRetry,
  onEdit,
  onNew,
  accounts,
  onNavigate,
}: {
  outcome: TransactionOutcome | null;
  attempt: PendingAttempt | null;
  submitting: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onNew: () => void;
  accounts: Account[];
  onNavigate: (path: string) => void;
}) {
  if (!outcome) {
    return (
      <div className="transaction-result-card">
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Preparing transaction result
        </div>
      </div>
    );
  }

  const isPosted = outcome.kind === 'posted';
  const isRefused = outcome.kind === 'refused';
  const isUncertain = outcome.kind === 'uncertain';
  const isConflict = outcome.kind === 'conflict';
  const payload = outcome.payload ?? attempt?.payload;
  const amountPaise = outcome.result?.amountPaise ?? payload?.amountPaise;
  const journalId = outcome.result?.journalTransactionId;
  const typeLabel =
    payload?.type === 'DEPOSIT' ? 'Deposit' : payload?.type === 'WITHDRAWAL' ? 'Withdrawal' : 'Transfer';

  return (
    <section
      className={`transaction-result-card result-${outcome.kind}`}
      aria-live="polite"
      aria-labelledby="transaction-result-title"
    >
      <span
        className={`result-mark ${
          isPosted ? 'result-mark-success' : isRefused ? 'result-mark-refused' : 'result-mark-pending'
        }`}
      >
        {isPosted ? '✓' : isRefused ? '!' : isUncertain ? '…' : isConflict ? '!' : '×'}
      </span>

      <span className="section-kicker">
        {isPosted
          ? 'LEDGER CONFIRMATION'
          : isRefused
            ? 'REQUEST REFUSED'
            : isUncertain
              ? 'CONFIRMATION PENDING'
              : isConflict
                ? 'IDEMPOTENCY CONFLICT'
                : 'REQUEST ERROR'}
      </span>

      <h2 id="transaction-result-title">
        {isPosted
          ? 'Transaction posted'
          : isRefused
            ? 'Transaction was not posted'
            : isUncertain
              ? 'Result not confirmed'
              : isConflict
                ? 'Request key conflict'
                : 'Transaction could not be completed'}
      </h2>

      <p className="result-message">{outcome.message ?? outcome.reason}</p>

      {(isPosted || isRefused) && (
        <div className="result-receipt">
          <div>
            <span>Type</span>
            <strong>{typeLabel}</strong>
          </div>
          <div>
            <span>Account</span>
            <strong>{formatReceiptAccounts(payload, accounts)}</strong>
          </div>
          <div>
            <span>Amount</span>
            <strong>{amountPaise ? formatMoney(amountPaise, 'INR') : '—'}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong className={isPosted ? 'posted-text' : 'refused-text'}>
              {isPosted ? 'POSTED' : 'REFUSED'}
            </strong>
          </div>
          {journalId && (
            <div>
              <span>Journal reference</span>
              <strong className="receipt-reference">{journalId}</strong>
            </div>
          )}
          {outcome.reason && (
            <div>
              <span>Reason</span>
              <strong>{outcome.reason.replaceAll('_', ' ')}</strong>
            </div>
          )}
        </div>
      )}

      {isUncertain && (
        <div className="uncertain-warning">
          <strong>Do not create another request.</strong>
          <span>
            Use “Retry same request” to check the original result. The original key and exact payload are retained.
          </span>
        </div>
      )}

      {isConflict && (
        <div className="uncertain-warning">
          <strong>No replacement key was created.</strong>
          <span>
            Starting a new transaction is a separate money movement request. Continue only if that is intentional.
          </span>
        </div>
      )}

      <div className="result-actions">
        {isUncertain && (
          <button className="button button-primary" onClick={onRetry} disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" />
                Checking…
              </>
            ) : (
              'Retry same request'
            )}
          </button>
        )}

        {outcome.kind === 'error' && (
          <button className="button button-outline" onClick={onEdit}>
            Edit details
          </button>
        )}

        {(isPosted || isRefused || isConflict || outcome.kind === 'error') && (
          <button className="button button-outline" onClick={onNew}>
            Start another transaction
          </button>
        )}

        {isPosted && payload?.type === 'TRANSFER' && journalId && (
          <button
            className="button button-primary"
            onClick={() => onNavigate(`/transfers/${encodeURIComponent(journalId)}`)}
          >
            View transfer details
          </button>
        )}

        {(isPosted || isRefused) && (
          <span className="result-confirmed-note">
            {isPosted ? 'Confirmed by the backend.' : 'Refusal recorded by the backend.'}
          </span>
        )}
      </div>
    </section>
  );
}

export default function FinancialTransactionPage({
  type,
  onNavigate,
}: {
  type: TransactionMode;
  onNavigate: (path: string) => void;
}) {
  const cfg = MODE_CONFIG[type];
  const { user, request, refreshAccounts, accountRefreshVersion, selectedAccountId, setSelectedAccountId } = useAuth();
  const userId = user?.id ?? '';

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [balances, setBalances] = useState<Record<string, { balancePaise?: string; currencyCode?: string; error?: unknown }>>({});
  const initialPending = useMemo(() => (userId ? loadPendingAttempt(userId, cfg.type) : null), [userId, cfg.type]);

  const [sourceId, setSourceId] = useState(
    initialPending?.payload?.sourceAccountId ?? initialPending?.payload?.accountId ?? selectedAccountId ?? ''
  );
  const [destId, setDestId] = useState(initialPending?.payload?.destinationAccountId ?? '');
  const [amountInput, setAmountInput] = useState(
    initialPending?.payload?.amountPaise ? paiseToInrInput(initialPending.payload.amountPaise) : ''
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState<PendingAttempt | null>(initialPending);
  const [step, setStep] = useState<'form' | 'review' | 'result'>(
    initialPending?.state === 'uncertain' || initialPending?.state === 'conflict'
      ? 'result'
      : initialPending
        ? 'review'
        : 'form'
  );
  const [outcome, setOutcome] = useState<TransactionOutcome | null>(
    initialPending?.state === 'uncertain'
      ? {
          kind: 'uncertain',
          message:
            'This earlier request has no confirmed response. Retry the same request to check its original idempotent result.',
        }
      : initialPending?.state === 'conflict'
        ? {
            kind: 'conflict',
            message: 'The server reported that this key was already used with a different request payload.',
          }
        : null
  );
  const [submitting, setSubmitting] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');

    fetchAccounts(request, { signal: controller.signal })
      .then(async (list) => {
        if (controller.signal.aborted) return;
        setAccounts(list);

        const savedSource = initialPending?.payload?.sourceAccountId ?? initialPending?.payload?.accountId;
        const resolvedSource =
          savedSource ?? (list.some((a) => a.id === selectedAccountId) ? selectedAccountId! : list[0]?.id ?? '');
        if (!savedSource && resolvedSource) setSourceId(resolvedSource);
        if (!list.some((a) => a.id === selectedAccountId)) setSelectedAccountId(resolvedSource || null);

        const entries = await Promise.all(
          list.map(async (acc) => {
            try {
              const bal = await fetchAccountBalance(request, acc.id, { signal: controller.signal });
              return [acc.id, { balancePaise: String(bal.balancePaise), currencyCode: bal.currencyCode }] as const;
            } catch (err: any) {
              if (err?.name === 'AbortError') throw err;
              return [acc.id, { error: err }] as const;
            }
          })
        );
        if (!controller.signal.aborted) {
          setBalances(Object.fromEntries(entries));
        }
        if (type === 'transfer' && !initialPending?.payload?.destinationAccountId) {
          setDestId(list.find((a) => a.id !== resolvedSource)?.id ?? '');
        }
      })
      .catch((err: any) => {
        if (err?.name !== 'AbortError') {
          setLoadError(
            err?.status === 403
              ? 'Your role does not permit this account operation.'
              : err?.status === 401
                ? 'Your session has expired. Sign in again to continue.'
                : err?.message || 'Accounts could not be loaded.'
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [accountRefreshVersion, request, initialPending, setSelectedAccountId, type]);

  const sourceAcc = accounts.find((a) => a.id === sourceId);
  const destAcc = accounts.find((a) => a.id === destId);
  const sourceBal = balances[sourceId];
  const destBal = balances[destId];
  const isTransfer = type === 'transfer';
  const isDeposit = type === 'deposit';

  function handleResetNew() {
    clearPendingAttempt(userId, cfg.type);
    setPending(null);
    setOutcome(null);
    setAmountInput('');
    setFormError('');
    setStep('form');
  }

  function handleReviewSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    let amountPaise: string;
    try {
      amountPaise = parseInrToPaise(amountInput);
    } catch (err: any) {
      setFormError(err.message);
      return;
    }

    if (!sourceId || !sourceAcc) {
      setFormError('Choose an account returned by your account list.');
      return;
    }

    if (isTransfer && (!destId || !destAcc)) {
      setFormError('Choose a destination account.');
      return;
    }

    if (isTransfer && sourceId === destId) {
      setFormError('Source and destination accounts must be different.');
      return;
    }

    const payload: TransactionPayload = {
      type: cfg.type,
      ...(isDeposit || type === 'withdrawal' ? { accountId: sourceId } : {}),
      ...(isTransfer ? { sourceAccountId: sourceId, destinationAccountId: destId } : {}),
      amountPaise,
    };

    if (pending?.state === 'uncertain') {
      setOutcome({
        kind: 'uncertain',
        message:
          'This request has an uncertain result. Retry the exact same details with its existing key before starting any other transaction.',
      });
      setStep('result');
      return;
    }

    try {
      const payloadKey = getPayloadKey(payload);
      const nextAttempt: PendingAttempt =
        pending?.payloadKey === payloadKey && pending?.idempotencyKey
          ? pending
          : {
              idempotencyKey: globalThis.crypto.randomUUID(),
              payload,
              payloadKey,
              state: 'review',
            };
      savePendingAttempt(userId, cfg.type, nextAttempt);
      setPending(nextAttempt);
      setOutcome(null);
      setStep('review');
    } catch {
      setFormError('A secure transaction key could not be prepared. Check browser storage and use a supported secure browser.');
    }
  }

  async function executeTransaction(attemptToSend: PendingAttempt | null = pending) {
    if (!attemptToSend || inFlightRef.current) return;
    inFlightRef.current = true;
    setSubmitting(true);
    setOutcome(null);

    const uncertainAttempt: PendingAttempt = { ...attemptToSend, state: 'uncertain' };
    try {
      savePendingAttempt(userId, cfg.type, uncertainAttempt);
      setPending(uncertainAttempt);
    } catch {
      setOutcome({
        kind: 'error',
        message: 'The request was not sent because its idempotency key could not be saved safely.',
      });
      setStep('result');
      inFlightRef.current = false;
      setSubmitting(false);
      return;
    }

    try {
      const { type: _omitType, ...bodyPayload } = uncertainAttempt.payload;
      const result = await request(cfg.endpoint, {
        method: 'POST',
        body: { ...bodyPayload, idempotencyKey: uncertainAttempt.idempotencyKey },
        headers: { 'Idempotency-Key': uncertainAttempt.idempotencyKey },
      });

      if (result.status !== 'POSTED' || !result.journalTransactionId) {
        throw new ApiError('The server response did not confirm a posted transaction.', 502, result);
      }

      clearPendingAttempt(userId, cfg.type);
      setPending(null);
      setOutcome({ kind: 'posted', result, payload: uncertainAttempt.payload });
      setStep('result');
      refreshAccounts();
    } catch (err: any) {
      if (err?.payload?.status === 'REFUSED') {
        clearPendingAttempt(userId, cfg.type);
        setPending(null);
        setOutcome({
          kind: 'refused',
          reason: err.payload.reason,
          message: mapTransactionError(err),
          payload: uncertainAttempt.payload,
          httpStatus: err.status,
        });
        setStep('result');
        refreshAccounts();
      } else if (err?.payload?.error === 'idempotency_key_conflict') {
        const conflictAttempt: PendingAttempt = { ...uncertainAttempt, state: 'conflict' };
        try {
          savePendingAttempt(userId, cfg.type, conflictAttempt);
        } catch {}
        setPending(conflictAttempt);
        setOutcome({
          kind: 'conflict',
          message: 'This idempotency key belongs to a different request. No new key was generated automatically.',
        });
        setStep('result');
      } else if (err instanceof ApiError && (err.status === 0 || err.status >= 500)) {
        try {
          savePendingAttempt(userId, cfg.type, uncertainAttempt);
        } catch {}
        setPending(uncertainAttempt);
        setOutcome({
          kind: 'uncertain',
          message:
            'The server did not confirm the result. The transaction may have completed. Retry this exact request with the same key; do not start a new transaction.',
        });
        setStep('result');
      } else {
        const reviewAttempt: PendingAttempt = { ...uncertainAttempt, state: 'review' };
        try {
          savePendingAttempt(userId, cfg.type, reviewAttempt);
        } catch {}
        setPending(reviewAttempt);
        setOutcome({
          kind: 'error',
          message: err instanceof ApiError ? mapTransactionError(err) : 'The request could not be completed.',
          payload: uncertainAttempt.payload,
        });
        setStep('result');
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  const availablePaise = sourceBal && !sourceBal.error && sourceBal.balancePaise ? BigInt(sourceBal.balancePaise) : null;
  let exceedsBalance = false;
  try {
    exceedsBalance =
      (type === 'withdrawal' || isTransfer) &&
      availablePaise !== null &&
      amountInput.trim() !== '' &&
      BigInt(parseInrToPaise(amountInput)) > availablePaise;
  } catch {
    exceedsBalance = false;
  }

  return (
    <section className="transaction-page">
      <button className="back-link" onClick={() => onNavigate('/dashboard')}>
        ← <span>Back to overview</span>
      </button>

      <div className="transaction-page-heading">
        <span className="section-kicker">SECURE MONEY MOVEMENT</span>
        <h1>{cfg.title}</h1>
        <p>{cfg.intro}</p>
      </div>

      {loading ? (
        <div className="loading-row">
          <span className="spinner spinner-dark" />
          Loading permitted accounts
        </div>
      ) : loadError ? (
        <div className="account-error-panel" role="alert">
          <span className="error-mark">!</span>
          <div>
            <strong>Accounts could not be loaded</strong>
            <p>{loadError}</p>
          </div>
          <button className="button button-outline" onClick={() => refreshAccounts()}>
            Retry
          </button>
        </div>
      ) : accounts.length === 0 ? (
        <div className="empty-state transaction-empty">
          <strong>No accounts available</strong>
          <p>Money movement requires an account returned by your account access list.</p>
        </div>
      ) : step === 'form' ? (
        <form className="transaction-form-card" onSubmit={handleReviewSubmit}>
          <div className="transaction-form-top">
            <span className="transaction-type-mark">{isDeposit ? '↓' : isTransfer ? '↗' : '↑'}</span>
            <div>
              <strong>{cfg.title} details</strong>
              <small>Amounts are entered in Indian rupees (INR).</small>
            </div>
          </div>

          <div className={`transaction-fields ${isTransfer ? 'transaction-fields-transfer' : ''}`}>
            <label className="field-label">
              <span>{isDeposit ? 'Deposit to account' : isTransfer ? 'From account' : 'Withdraw from account'}</span>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setSelectedAccountId(e.target.value);
                  if (isTransfer && e.target.value === destId) {
                    setDestId(accounts.find((a) => a.id !== e.target.value)?.id ?? '');
                  }
                }}
                required
              >
                <option value="" disabled>
                  Select an account
                </option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.accountNumber} · {acc.type}
                  </option>
                ))}
              </select>
            </label>

            {isTransfer && (
              <label className="field-label">
                <span>To account</span>
                <select value={destId} onChange={(e) => setDestId(e.target.value)} required>
                  <option value="" disabled>
                    Select destination
                  </option>
                  {accounts
                    .filter((a) => a.id !== sourceId)
                    .map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountNumber} · {acc.type}
                      </option>
                    ))}
                </select>
              </label>
            )}

            <label className="field-label amount-field">
              <span>Amount</span>
              <span className="amount-input-wrap">
                <span aria-hidden="true">₹</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={24}
                  value={amountInput}
                  onChange={(e) => {
                    setAmountInput(e.target.value);
                    setFormError('');
                  }}
                  placeholder="0.00"
                  aria-describedby="amount-help"
                  required
                />
              </span>
              <small id="amount-help" className="field-hint">
                Up to two decimal places. The server rechecks available funds before posting.
              </small>
            </label>
          </div>

          {sourceAcc && (
            <div className="selected-account-summary">
              <span className="account-summary-icon">{sourceAcc.type === 'BUSINESS' ? 'B' : 'P'}</span>
              <div>
                <strong>{sourceAcc.accountNumber}</strong>
                <small>
                  {sourceAcc.type} · {sourceAcc.status} · {sourceAcc.currencyCode}
                </small>
              </div>
              {sourceBal && !sourceBal.error && sourceBal.balancePaise !== undefined && (
                <span className="summary-balance">
                  {formatMoney(sourceBal.balancePaise, sourceBal.currencyCode)}
                </span>
              )}
            </div>
          )}

          {isTransfer && destAcc && (
            <div className="selected-account-summary destination-summary">
              <span className="account-summary-icon">{destAcc.type === 'BUSINESS' ? 'B' : 'P'}</span>
              <div>
                <strong>{destAcc.accountNumber}</strong>
                <small>
                  Destination · {destAcc.status} · {destAcc.currencyCode}
                </small>
              </div>
              {destBal && !destBal.error && destBal.balancePaise !== undefined && (
                <span className="summary-balance">
                  {formatMoney(destBal.balancePaise, destBal.currencyCode)}
                </span>
              )}
            </div>
          )}

          {Boolean(sourceBal?.error) && (
            <p className="balance-unavailable-note">
              The current balance could not be loaded. The server will validate the transaction.
            </p>
          )}

          {exceedsBalance && (
            <div className="balance-warning" role="status">
              The amount exceeds the displayed balance. The backend is authoritative and will refuse an overdraft.
            </div>
          )}

          {formError && (
            <div className="form-error" role="alert">
              <span>!</span>
              {formError}
            </div>
          )}

          <div className="transaction-form-footer">
            <span>
              <i /> All postings are confirmed by the secure ledger.
            </span>
            <button className="button button-primary" type="submit">
              Review {cfg.verb}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      ) : step === 'review' ? (
        <div
          className="transaction-review-card"
          role="region"
          aria-labelledby="transaction-review-title"
        >
          <div className="review-topline">
            <span className="section-kicker">FINAL CHECK</span>
            <span className="review-step">STEP 2 OF 2</span>
          </div>
          <h2 id="transaction-review-title">Review your {cfg.verb}</h2>
          <p className="review-description">Check the details carefully before sending this request to the ledger.</p>

          <div className="review-route">
            <ReviewParty label={isDeposit ? 'DEPOSIT TO' : 'FROM'} account={sourceAcc} />
            {isTransfer && (
              <>
                <span className="review-route-arrow">→</span>
                <ReviewParty label="TRANSFER TO" account={destAcc} />
              </>
            )}
          </div>

          <div className="review-amount">
            <span>AMOUNT</span>
            <strong>{pending?.payload?.amountPaise ? formatMoney(pending.payload.amountPaise, 'INR') : '—'}</strong>
          </div>

          <div className="idempotency-note">
            <span className="idempotency-lock">✓</span>
            <p>
              A unique request key is saved for this transaction. If the connection is interrupted, retrying uses the
              same key and payload.
            </p>
          </div>

          <div className="review-actions">
            <button className="button button-outline" onClick={() => setStep('form')} disabled={submitting}>
              Back to edit
            </button>
            <button className="button button-primary" onClick={() => executeTransaction()} disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" />
                  Submitting…
                </>
              ) : (
                <>
                  Confirm and submit <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <TransactionResult
          outcome={outcome}
          attempt={pending}
          submitting={submitting}
          onRetry={() => executeTransaction(pending)}
          onEdit={() => setStep('form')}
          onNew={handleResetNew}
          accounts={accounts}
          onNavigate={onNavigate}
        />
      )}

      <p className="transaction-security-note">
        No balance is changed in the browser. The backend authorizes each request, enforces idempotency, and confirms
        ledger postings.
      </p>
    </section>
  );
}
