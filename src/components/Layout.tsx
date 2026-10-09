import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Church, Home, Images, LayoutGrid, PlaySquare, Radio } from 'lucide-react';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import type { Live } from '../lib/types';
import { ConfirmHost, Toasts } from './ui';

let liveCache: Live | null = null;
const liveListeners = new Set<(l: Live) => void>();

/** Estado da live compartilhado pelo app inteiro (atualiza a cada minuto e quando o app volta a ficar visível). */
export function useLiveState(): [Live | null, () => Promise<void>] {
  const [live, setLive] = useState<Live | null>(liveCache);
  useEffect(() => {
    liveListeners.add(setLive);
    return () => {
      liveListeners.delete(setLive);
    };
  }, []);
  return [live, refreshLive];
}

export async function refreshLive() {
  try {
    const l = await api<Live>('/live');
    liveCache = l;
    liveListeners.forEach((fn) => fn(l));
  } catch {
    /* sem internet */
  }
}

export function Layout({ children }: { children: ReactNode }) {
  const { isMember } = useSession();
  const { pathname } = useLocation();
  const [live] = useLiveState();

  useEffect(() => {
    void refreshLive();
    const t = setInterval(() => document.visibilityState === 'visible' && void refreshLive(), 60_000);
    const onVis = () => document.visibilityState === 'visible' && void refreshLive();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const hideTabs = pathname.startsWith('/transmitir');
  const tabs = isMember
    ? [
        { to: '/', label: 'Início', icon: <Home />, end: true },
        { to: '/ao-vivo', label: 'Ao vivo', icon: <Radio />, live: true },
        { to: '/fotos', label: 'Fotos', icon: <Images /> },
        { to: '/agenda', label: 'Agenda', icon: <CalendarDays /> },
        { to: '/mais', label: 'Mais', icon: <LayoutGrid /> },
      ]
    : [
        { to: '/', label: 'Início', icon: <Home />, end: true },
        { to: '/ao-vivo', label: 'Ao vivo', icon: <Radio />, live: true },
        { to: '/videos', label: 'Vídeos', icon: <PlaySquare /> },
        { to: '/igreja', label: 'A igreja', icon: <Church /> },
        { to: '/mais', label: 'Mais', icon: <LayoutGrid /> },
      ];

  return (
    <div className="app" style={hideTabs ? { paddingBottom: 0 } : undefined}>
      {children}
      {!hideTabs && (
        <nav className="tabbar" aria-label="Navegação principal">
          <div className="tabbar-in">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `tab ${isActive ? 'active' : ''}`}>
                {t.icon}
                <span>{t.label}</span>
                {t.live && live?.active && <span className="dot pulse" aria-label="ao vivo agora" />}
              </NavLink>
            ))}
          </div>
        </nav>
      )}
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
