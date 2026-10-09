import { api } from './api';

export const TOPIC_LABELS: Record<string, { label: string; hint: string; members?: boolean }> = {
  lives: { label: 'Lives', hint: 'Quando a igreja entrar ao vivo' },
  cultos: { label: 'Lembrete dos cultos', hint: 'Antes de cada culto' },
  eventos: { label: 'Eventos', hint: 'Eventos novos e lembretes' },
  palavra: { label: 'Palavra do dia', hint: 'Mensagem diária da liderança' },
  avisos: { label: 'Avisos', hint: 'Recados importantes da igreja' },
  fotos: { label: 'Fotos novas', hint: 'Quando alguém publica fotos', members: true },
  oracao: { label: 'Pedidos de oração', hint: 'Novos pedidos no mural', members: true },
};
export const DEFAULT_TOPICS = ['lives', 'cultos', 'eventos', 'palavra', 'avisos'];

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

export async function pushStatus(): Promise<{ subscribed: boolean; topics: string[] }> {
  const sub = await currentSubscription();
  if (!sub) return { subscribed: false, topics: [] };
  return api('/push/status', { method: 'POST', body: { endpoint: sub.endpoint } });
}

export async function subscribePush(topics: string[]): Promise<void> {
  if (!pushSupported()) throw new Error('Este navegador não recebe notificações.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notificações bloqueadas. Libere nas configurações do navegador.');
  const reg = await registration();
  const { publicKey } = await api<{ publicKey: string }>('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const current = sub.options?.applicationServerKey;
    const same =
      current &&
      new Uint8Array(current).length === b64ToBytes(publicKey).length &&
      new Uint8Array(current).every((v, i) => v === b64ToBytes(publicKey)[i]);
    if (!same) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), topics } });
}

export async function unsubscribePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => undefined);
  await sub.unsubscribe();
}

/** Depois do login, liga a inscrição existente deste aparelho à pessoa. */
export async function relinkPush(): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (!sub) return;
    const st = await api<{ subscribed: boolean; topics: string[] }>('/push/status', {
      method: 'POST',
      body: { endpoint: sub.endpoint },
    });
    await api('/push/subscribe', {
      method: 'POST',
      body: { subscription: sub.toJSON(), topics: st.subscribed ? st.topics : DEFAULT_TOPICS },
    });
  } catch {
    /* sem problema */
  }
}

/** Ao sair da conta: este aparelho deixa de receber avisos pessoais e de membros. */
export async function unlinkPush(): Promise<void> {
  try {
    const sub = await currentSubscription();
    if (sub) await api('/push/unlink', { method: 'POST', body: { endpoint: sub.endpoint } });
  } catch {
    /* sem problema */
  }
}

/** Depois de publicar algo com aviso, ajuda a enviar as notificações mais rápido. */
export async function helpDrain(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await api<{ remaining: number }>('/push/drain', { method: 'POST' });
      if (!r.remaining) return;
    } catch {
      return;
    }
  }
}
