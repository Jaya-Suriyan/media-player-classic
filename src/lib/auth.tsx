import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type User } from "./api";

interface AuthState {
  user: User | null;
  checked: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    api.auth
      .me()
      .then((r) => setUser(r.user))
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.auth.login(email, password);
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    setUser(null);
  }, []);

  return <AuthCtx.Provider value={{ user, checked, login, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
