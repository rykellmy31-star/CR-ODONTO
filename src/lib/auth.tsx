import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { MembershipClinic, SessionUser } from "./types";

interface AuthState {
  user: SessionUser | null;
  clinics: MembershipClinic[];
  loading: boolean;
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null, clinics: [], loading: true, reload: async () => {}, logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [clinics, setClinics] = useState<MembershipClinic[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await api.get<{ user: SessionUser | null; clinics: MembershipClinic[] }>("/auth/me");
      setUser(res.user);
      setClinics(res.clinics ?? []);
    } catch {
      setUser(null);
      setClinics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => null);
    setUser(null);
    setClinics([]);
  }, []);

  const value = useMemo(() => ({ user, clinics, loading, reload, logout }), [user, clinics, loading, reload, logout]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
