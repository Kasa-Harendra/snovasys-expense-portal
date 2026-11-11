import type {
  Account,
  AccountBalance,
  AuditResponse,
  Role,
  StatementEventItem,
  StatementResponse,
  TransferDetail,
} from '../types';

declare global {
  interface Window {
    __BV_API_URL__?: string;
  }
}

export const API_BASE_URL = (
  window.__BV_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  ''
).replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  payload: any;

  constructor(message: string, status: number, payload: any = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
  headers?: HeadersInit;
}

export async function apiRequest<T = any>(
  path: string,
  { method = 'GET', body, token, signal, onUnauthorized, headers }: RequestOptions = {}
): Promise<T> {
  const reqHeaders = new Headers({ Accept: 'application/json' });
  if (headers) {
    new Headers(headers).forEach((value, key) => reqHeaders.set(key, value));
  }
  if (body !== undefined) {
    reqHeaders.set('Content-Type', 'application/json');
  }
  if (token) {
    reqHeaders.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: reqHeaders,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Unable to reach BalanceVault. Check your connection and try again.', 0);
  }

  let payload: any = {};
  try {
    payload = await response.json();
  } catch {
    // Response had no JSON body
  }

  if (response.status === 401 && token && onUnauthorized) {
    onUnauthorized();
  }

  if (!response.ok) {
    const message = typeof payload.error === 'string' ? payload.error : 'The request could not be completed.';
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export async function checkReadiness(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/ready`, {
      headers: { Accept: 'application/json' },
      signal,
    });
    return res.ok;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err;
    return false;
  }
}

export type AuthedRequestFn = <T = any>(path: string, options?: RequestOptions) => Promise<T>;

export async function fetchAccounts(request: AuthedRequestFn, options?: RequestOptions): Promise<Account[]> {
  const data = await request<{ accounts?: Account[] }>('/api/accounts', options);
  return Array.isArray(data.accounts) ? data.accounts : [];
}

export async function fetchAccountById(
  request: AuthedRequestFn,
  accountId: string,
  options?: RequestOptions
): Promise<Account> {
  const data = await request<{ account: Account }>(`/api/accounts/${encodeURIComponent(accountId)}`, options);
  return data.account;
}

export async function fetchAccountBalance(
  request: AuthedRequestFn,
  accountId: string,
  options?: RequestOptions
): Promise<AccountBalance> {
  return request<AccountBalance>(`/api/accounts/${encodeURIComponent(accountId)}/balance`, options);
}

export async function createCustomerAccount(
  request: AuthedRequestFn,
  payload: { accountNumber: string; accountType: string; holderUserId: string }
): Promise<Account> {
  const data = await request<{ account: Account }>('/api/accounts', {
    method: 'POST',
    body: payload,
  });
  return data.account;
}

export async function fetchAccountStatement(
  request: AuthedRequestFn,
  accountId: string,
  options: RequestOptions & { limit?: number; cursor?: string | null } = {}
): Promise<StatementResponse> {
  const { limit = 25, cursor, ...reqOpts } = options;
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request<StatementResponse>(`/api/accounts/${encodeURIComponent(accountId)}/statement?${params}`, reqOpts);
}

export async function fetchAuditLogs(
  request: AuthedRequestFn,
  page = 1,
  perPage = 25,
  options?: RequestOptions
): Promise<AuditResponse> {
  const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  return request<AuditResponse>(`/api/audit?${params}`, options);
}

export async function fetchTransferDetails(
  request: AuthedRequestFn,
  transferId: string,
  options?: RequestOptions
): Promise<TransferDetail> {
  const data = await request<{ transfer: TransferDetail }>(`/api/transfers/${encodeURIComponent(transferId)}`, options);
  return data.transfer;
}

export function formatMoney(paiseInput: string | number | bigint, currencyCode = 'INR'): string {
  let paise: bigint;
  try {
    paise = BigInt(paiseInput);
  } catch {
    return 'Balance unavailable';
  }
  const negative = paise < 0n;
  const absPaise = negative ? -paise : paise;
  const whole = absPaise / 100n;
  const frac = String(absPaise % 100n).padStart(2, '0');
  const formattedWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(whole);
  const prefix = currencyCode === 'INR' ? '₹' : `${currencyCode} `;
  return `${negative ? '-' : ''}${prefix}${formattedWhole}.${frac}`;
}

export function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function getEventDirection(event: StatementEventItem): 'Credit' | 'Debit' | 'Not posted' | '—' {
  if (event.status !== 'POSTED') return 'Not posted';
  const amount = BigInt(event.amountPaise);
  if (amount > 0n) return 'Credit';
  if (amount < 0n) return 'Debit';
  return '—';
}

export const ROLE_LABELS: Record<Role | string, string> = {
  ADMIN: 'Administrator',
  ACCOUNT_HOLDER: 'Account holder',
  AUDITOR: 'Auditor',
};

export interface NavItem {
  path: string;
  label: string;
  icon: 'grid' | 'cards' | 'activity' | 'plus' | 'building' | 'shield';
}

export function getNavForRole(role?: Role | string): NavItem[] {
  return [
    { path: '/dashboard', label: 'Overview', icon: 'grid' },
    { path: '/accounts', label: 'Accounts', icon: 'cards' },
    { path: '/statements', label: 'Statements', icon: 'activity' },
    ...(role === 'ACCOUNT_HOLDER'
      ? [{ path: '/account-requests', label: 'Account request', icon: 'plus' as const }]
      : []),
    ...(role === 'ADMIN'
      ? [
          { path: '/admin/users', label: 'User management', icon: 'building' as const },
          { path: '/admin/onboarding', label: 'Onboarding', icon: 'cards' as const },
          { path: '/audit', label: 'Audit log', icon: 'shield' as const },
        ]
      : role === 'AUDITOR'
        ? [{ path: '/audit', label: 'Audit log', icon: 'shield' as const }]
        : []),
  ];
}
