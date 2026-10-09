import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearApiCache } from './api';
import type { Boot, Me } from './types';
import { relinkPush, unlinkPush } from './push';

interface SessionValue extends Boot {
  ready: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setUser: (u: Me | null) => void;
  logout: () => Promise<void>;
  isMember: boolean;
  isMedia: boolean;
  isLeader: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<SessionValue | null>(null);

const RANK: Record<string, number> = { membro: 1, midia: 2, lider: 3, admin: 4 };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const b = await api<Boot>('/boot');
      setBoot(b);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Liga a inscrição de notificações deste aparelho à pessoa logada.
  const userId = boot?.user?.id ?? null;
  useEffect(() => {
    if (userId) void relinkPush();
  }, [userId]);

  const logout = useCallback(async () => {
    await unlinkPush();
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    clearApiCache();
    try {
      await caches.delete('irn-media');
    } catch {
      /* sem cache */
    }
    await refresh();
  }, [refresh]);

  const value = useMemo<SessionValue | null>(() => {
    if (!boot) return null;
    const u = boot.user;
    const approved = !!u && u.status === 'aprovado';
    const rank = approved ? RANK[u!.role] ?? 0 : 0;
    return {
      ...boot,
      ready: true,
      error,
      refresh,
      logout,
      setUser: (user) => setBoot((b) => (b ? { ...b, user } : b)),
      isMember: approved,
      isMedia: rank >= 2,
      isLeader: rank >= 3,
      isAdmin: rank >= 4,
    };
  }, [boot, error, refresh, logout]);

  if (!value) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
        {error ? (
          <div className="stack" style={{ maxWidth: 320 }}>
            <p style={{ fontWeight: 650 }}>Não consegui abrir o app.</p>
            <p className="muted small">{error}</p>
            <button className="btn btn-primary" onClick={() => void refresh()}>
              Tentar de novo
            </button>
          </div>
        ) : (
          <div className="splash">
            <img src="/api/brand/logo" alt="" width={84} height={84} style={{ borderRadius: 999, margin: '0 auto' }} />
          </div>
        )}
      </div>
    );
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fora do SessionProvider');
  return v;
}
