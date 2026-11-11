import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { apiRequest, AuthedRequestFn, RequestOptions } from '../api/client';
import type { SessionData, User } from '../types';

const SESSION_STORAGE_KEY = 'balancevault.session.v1';

interface AuthContextValue {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (params: { email: string; password: string }) => Promise<User>;
  register: (params: { name: string; email: string; password: string }) => Promise<User>;
  acceptInvitation: (params: { token: string; password: string }) => Promise<User>;
  logout: () => void;
  request: AuthedRequestFn;
  accountRefreshVersion: number;
  refreshAccounts: () => void;
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredSession(): SessionData | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    if (
      !raw?.accessToken ||
      !raw?.user?.id ||
      !raw?.user?.email ||
      !Number.isFinite(raw?.expiresAt) ||
      raw.expiresAt <= Date.now()
    ) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return raw as SessionData;
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionData | null>(loadStoredSession);
  const [accountRefreshVersion, setAccountRefreshVersion] = useState(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setSelectedAccountId(null);
  }, []);

  const refreshAccounts = useCallback(() => {
    setAccountRefreshVersion((v) => v + 1);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setSession((prev) => {
      if (!prev) return prev;
      const updated: SessionData = { ...prev, user: { ...prev.user, ...patch } };
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const persistAuthResponse = useCallback((res: { accessToken?: string; user?: User; expiresIn?: number }) => {
    if (!res?.accessToken || !res?.user?.id || !res?.user?.email) {
      throw new Error('The server returned an invalid authentication response.');
    }
    const nextSession: SessionData = {
      accessToken: res.accessToken,
      user: res.user,
      expiresAt: Date.now() + (Number(res.expiresIn) || 900) * 1000,
    };
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    return res.user;
  }, []);

  const login = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { email: email.trim().toLowerCase(), password },
      });
      return persistAuthResponse(res);
    },
    [persistAuthResponse]
  );

  const register = useCallback(
    async ({ name, email, password }: { name: string; email: string; password: string }) => {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim().toLowerCase(), password },
      });
      return persistAuthResponse(res);
    },
    [persistAuthResponse]
  );

  const acceptInvitation = useCallback(
    async ({ token, password }: { token: string; password: string }) => {
      const res = await apiRequest('/api/auth/accept-invitation', {
        method: 'POST',
        body: { token, password },
      });
      return persistAuthResponse(res);
    },
    [persistAuthResponse]
  );

  const request: AuthedRequestFn = useCallback(
    <T = any>(path: string, options: RequestOptions = {}) =>
      apiRequest<T>(path, {
        ...options,
        token: session?.accessToken,
        onUnauthorized: logout,
      }),
    [logout, session?.accessToken]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      accessToken: session?.accessToken ?? null,
      isAuthenticated: !!session?.accessToken,
      login,
      register,
      acceptInvitation,
      logout,
      request,
      accountRefreshVersion,
      refreshAccounts,
      selectedAccountId,
      setSelectedAccountId,
      updateUser,
    }),
    [
      accountRefreshVersion,
      acceptInvitation,
      login,
      logout,
      refreshAccounts,
      register,
      request,
      selectedAccountId,
      session,
      updateUser,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
