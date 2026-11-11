export type Role = 'ADMIN' | 'ACCOUNT_HOLDER' | 'AUDITOR';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive?: boolean;
  createdAt?: string;
}

export interface SessionData {
  accessToken: string;
  user: User;
  expiresAt: number;
}

export interface Account {
  id: string;
  userId: string;
  accountNumber: string;
  type: string;
  currencyCode: string;
  status: string;
  createdAt: string;
}

export interface AccountBalance {
  balancePaise: string;
  currencyCode: string;
}

export interface StatementEventItem {
  id: string;
  accountId: string;
  type: string;
  status: 'POSTED' | 'REFUSED' | string;
  amountPaise: string;
  runningBalancePaise: string;
  reference?: string | null;
  note?: string | null;
  refusalReason?: string | null;
  timestamp: string;
  actor?: {
    role?: string;
  };
}

export interface StatementResponse {
  account: {
    id: string;
    accountNumber: string;
    type: string;
    currencyCode: string;
  };
  events: StatementEventItem[];
  nextCursor?: string | null;
}

export interface TransferEntry {
  id: string;
  amountPaise: string;
  direction: 'DEBIT' | 'CREDIT';
  account: {
    id: string;
    accountNumber: string;
    type: string;
    currencyCode: string;
  };
}

export interface TransferDetail {
  id: string;
  type?: string;
  status: string;
  amountPaise: string;
  createdAt: string;
  entries: TransferEntry[];
}

export interface AccountRequestItem {
  id: string;
  userId: string;
  requestedType: string;
  status: string;
  reviewNote?: string | null;
  createdAt: string;
  user?: {
    id: string;
    fullName: string;
    email: string;
  };
}

export interface InvitationItem {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  token?: string;
  status: string;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
}

export interface AuditEventItem {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: {
    id: string;
    email: string;
    role: string;
  };
  metadata?: unknown;
  createdAt: string;
}

export interface AuditResponse {
  events: AuditEventItem[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
}
