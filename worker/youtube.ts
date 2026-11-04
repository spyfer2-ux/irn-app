/**
 * Conta do YouTube de cada pessoa (para fazer live pela câmera do app) e as chamadas à API do YouTube.
 *
 * A permissão é pedida no mesmo login do Google do app (escopo "youtube", com acesso offline): o Google devolve um
 * refresh token, que fica guardado criptografado (AES-GCM, chave derivada do GOOGLE_CLIENT_SECRET). Com ele o app
 * cria a live no canal DA PESSOA — por isso não depende da senha do canal da igreja nem do mínimo de 50 inscritos,
 * que só vale para o botão "Transmitir" do aplicativo do YouTube.
 */
import type { Env } from './types';
import { b64urlToBytes, bytesToB64url, fail, fromUtf8, HttpError, now, utf8 } from './util';

export const YT_SCOPE = 'https://www.googleapis.com/auth/youtube';
const YT_SCOPE_SSL = 'https://www.googleapis.com/auth/youtube.force-ssl';

const apiBase = (env: Env) => env.YOUTUBE_API_URL || 'https://www.googleapis.com/youtube/v3';
const tokenUrl = (env: Env) => env.OIDC_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const revokeUrl = (env: Env) => (env.OIDC_TOKEN_URL ? env.OIDC_TOKEN_URL.replace(/\/token$/, '/revoke') : 'https://oauth2.googleapis.com/revoke');

export function hasYoutubeScope(scope: string | undefined): boolean {
  const list = (scope ?? '').split(/\s+/);
  return list.includes(YT_SCOPE) || list.includes(YT_SCOPE_SSL);
}

// ---------------- criptografia dos tokens ----------------

let keyCache: { secret: string; key: CryptoKey } | null = null;

async function sealKey(env: Env): Promise<CryptoKey> {
  const secret = env.GOOGLE_CLIENT_SECRET;
  if (!secret) fail(503, 'O login com Google ainda não foi configurado.', 'config');
  if (keyCache?.secret === secret) return keyCache.key;
  const base = await crypto.subtle.importKey('raw', utf8(secret), 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8('irn-app/youtube'), info: utf8('tokens v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache = { secret, key };
  return key;
}

export async function seal(env: Env, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sealKey(env), utf8(text)));
  return `v1.${bytesToB64url(iv)}.${bytesToB64url(ct)}`;
}

export async function unseal(env: Env, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  try {
    const [v, iv, ct] = sealed.split('.');
    if (v !== 'v1' || !iv || !ct) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlToBytes(iv) }, await sealKey(env), b64urlToBytes(ct));
    return fromUtf8(new Uint8Array(pt));
  } catch {
    return null;
  }
}

// ---------------- erros ----------------

/** Erro vindo do YouTube/Google, com o "reason" que eles mandam (ex.: liveStreamingNotEnabled). */
export class YtError extends Error {
  status: number;
  reason: string;
  constructor(status: number, reason: string, message: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

/** Traduz um erro do YouTube numa mensagem para a pessoa (e um código que a tela usa para mostrar o passo a passo). */
export function ytHttpError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (!(e instanceof YtError)) {
    console.error('youtube', String(e));
    return new HttpError(502, 'Não consegui falar com o YouTube agora. Tente de novo em instantes.', 'youtube');
  }
  console.error('youtube', e.status, e.reason, e.message);
  switch (e.reason) {
    case 'liveStreamingNotEnabled':
    case 'insufficientLivePermissions':
      return new HttpError(403, 'Sua conta do YouTube ainda não está liberada para fazer lives.', 'live_desativada');
    case 'livePermissionBlocked':
      return new HttpError(403, 'O YouTube bloqueou as lives deste canal. Veja os avisos no YouTube Studio.', 'live_bloqueada');
    case 'accessNotConfigured':
    case 'SERVICE_DISABLED':
      return new HttpError(503, 'A API do YouTube ainda não foi ativada no Google Cloud do app. Avise o administrador.', 'api_desligada');
    case 'quotaExceeded':
    case 'dailyLimitExceeded':
      return new HttpError(429, 'O limite diário de uso do YouTube pelo app acabou. Tente amanhã ou transmita pelo app Larix.', 'cota');
    case 'userRequestsExceedRateLimit':
    case 'rateLimitExceeded':
      return new HttpError(429, 'Muitas tentativas seguidas no YouTube. Aguarde um minuto e tente de novo.', 'devagar');
    case 'userBroadcastsExceedLimit':
      return new HttpError(429, 'O YouTube limitou quantas lives esta conta pode criar hoje. Tente de novo amanhã.', 'limite_lives');
    case 'reconectar':
    case 'invalid_grant':
    case 'authError':
    case 'insufficientPermissions':
    case 'ACCESS_TOKEN_SCOPE_INSUFFICIENT':
      return new HttpError(401, 'A permissão do YouTube expirou ou foi removida. Conecte sua conta de novo.', 'reconectar');
    case 'youtubeSignupRequired':
    case 'channelNotFound':
    case 'sem_canal':
      return new HttpError(409, 'Esta conta do Google ainda não tem um canal no YouTube.', 'sem_canal');
    default:
      return new HttpError(502, `O YouTube recusou o pedido (${e.reason || e.status}). Tente de novo em instantes.`, 'youtube');
  }
}

// ---------------- conta ----------------

export interface YtAccount {
  user_id: number;
  email: string | null;
  channel_id: string | null;
  channel_title: string | null;
  channel_thumb: string | null;
  refresh_enc: string;
  access_enc: string | null;
  access_exp: number;
  stream_id: string | null;
  stream_key_enc: string | null;
  ingest_rtmps: string | null;
  ingest_rtmp: string | null;
  created_at: number;
  updated_at: number;
}

export interface Channel {
  id: string;
  title: string;
  thumb: string | null;
}

export async function getAccount(env: Env, userId: number): Promise<YtAccount | null> {
  return env.DB.prepare('SELECT * FROM yt_accounts WHERE user_id = ?').bind(userId).first<YtAccount>();
}

export async function saveAccount(
  env: Env,
  userId: number,
  a: { email: string | null; channel: Channel | null; refresh: string; access: string; expiresIn: number },
) {
  const t = now();
  await env.DB.prepare(
    `INSERT INTO yt_accounts (user_id, email, channel_id, channel_title, channel_thumb, refresh_enc, access_enc, access_exp, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stream_id = CASE WHEN yt_accounts.channel_id IS excluded.channel_id THEN yt_accounts.stream_id ELSE NULL END,
       stream_key_enc = CASE WHEN yt_accounts.channel_id IS excluded.channel_id THEN yt_accounts.stream_key_enc ELSE NULL END,
       ingest_rtmps = CASE WHEN yt_accounts.channel_id IS excluded.channel_id THEN yt_accounts.ingest_rtmps ELSE NULL END,
       ingest_rtmp = CASE WHEN yt_accounts.channel_id IS excluded.channel_id THEN yt_accounts.ingest_rtmp ELSE NULL END,
       email = excluded.email, channel_id = excluded.channel_id, channel_title = excluded.channel_title,
       channel_thumb = excluded.channel_thumb, refresh_enc = excluded.refresh_enc, access_enc = excluded.access_enc,
       access_exp = excluded.access_exp, updated_at = excluded.updated_at`,
  )
    .bind(
      userId,
      a.email,
      a.channel?.id ?? null,
      a.channel?.title ?? null,
      a.channel?.thumb ?? null,
      await seal(env, a.refresh),
      await seal(env, a.access),
      t + Math.max(60, a.expiresIn - 60) * 1000,
      t,
      t,
    )
    .run();
}

/** Access token válido (renova com o refresh token quando está para vencer). */
export async function accessToken(env: Env, acc: YtAccount): Promise<string> {
  if (acc.access_exp > now() + 60_000) {
    const t = await unseal(env, acc.access_enc);
    if (t) return t;
  }
  const refresh = await unseal(env, acc.refresh_enc);
  if (!refresh) throw new YtError(401, 'reconectar', 'refresh token ilegível');
  const res = await fetch(tokenUrl(env), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID ?? '',
      client_secret: env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !j.access_token) {
    if (j.error === 'invalid_grant' || j.error === 'unauthorized_client') {
      await env.DB.prepare('DELETE FROM yt_accounts WHERE user_id = ?').bind(acc.user_id).run();
      throw new YtError(401, 'reconectar', `refresh recusado: ${j.error}`);
    }
    throw new YtError(502, j.error || 'token', `renovação do token falhou (${res.status})`);
  }
  const exp = now() + Math.max(60, (j.expires_in ?? 3600) - 60) * 1000;
  const sealed = await seal(env, j.access_token);
  await env.DB.prepare('UPDATE yt_accounts SET access_enc = ?, access_exp = ?, updated_at = ? WHERE user_id = ?')
    .bind(sealed, exp, now(), acc.user_id)
    .run();
  acc.access_enc = sealed;
  acc.access_exp = exp;
  return j.access_token;
}

/** Desconecta: avisa o Google para apagar a permissão e esquece os tokens. */
export async function forgetAccount(env: Env, userId: number) {
  const acc = await getAccount(env, userId);
  if (!acc) return;
  const refresh = await unseal(env, acc.refresh_enc);
  if (refresh) {
    try {
      await fetch(revokeUrl(env), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh }),
      });
    } catch {
      /* sem internet: o token só deixa de ser usado */
    }
  }
  await env.DB.prepare('DELETE FROM yt_accounts WHERE user_id = ?').bind(userId).run();
}

// ---------------- API do YouTube ----------------

type Query = Record<string, string>;

export async function yt<T>(env: Env, token: string, method: 'GET' | 'POST' | 'DELETE', path: string, query: Query, payload?: unknown): Promise<T> {
  const url = new URL(apiBase(env) + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (payload !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url.toString(), { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let j: unknown = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    j = null;
  }
  if (!res.ok) {
    const err = (j as { error?: { message?: string; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } } | null)
      ?.error;
    const reason =
      err?.errors?.find((x) => x.reason)?.reason ||
      err?.details?.find((x) => x.reason)?.reason ||
      err?.status ||
      (res.status === 401 ? 'authError' : `http${res.status}`);
    throw new YtError(res.status, reason, err?.message ?? text.slice(0, 200));
  }
  return j as T;
}

interface ChannelList {
  items?: { id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } } }[];
}

export async function fetchChannel(env: Env, token: string): Promise<Channel | null> {
  const r = await yt<ChannelList>(env, token, 'GET', '/channels', { part: 'snippet', mine: 'true' });
  const c = r?.items?.[0];
  if (!c) return null;
  const thumb = c.snippet?.thumbnails?.default?.url ?? null;
  return { id: c.id, title: c.snippet?.title || 'Meu canal', thumb: thumb && thumb.startsWith('https://') ? thumb : null };
}

export async function updateChannel(env: Env, userId: number, ch: Channel | null) {
  await env.DB.prepare(
    `UPDATE yt_accounts SET channel_id = ?, channel_title = ?, channel_thumb = ?, updated_at = ?,
       stream_id = CASE WHEN channel_id IS ? THEN stream_id ELSE NULL END,
       stream_key_enc = CASE WHEN channel_id IS ? THEN stream_key_enc ELSE NULL END
     WHERE user_id = ?`,
  )
    .bind(ch?.id ?? null, ch?.title ?? null, ch?.thumb ?? null, now(), ch?.id ?? null, ch?.id ?? null, userId)
    .run();
}

interface LiveStreamRes {
  id: string;
  cdn?: { ingestionInfo?: { streamName?: string; ingestionAddress?: string; rtmpsIngestionAddress?: string } };
  status?: { streamStatus?: string; healthStatus?: { status?: string } };
}

export interface Ingest {
  streamId: string;
  key: string;
  /** Endereço preferido (RTMPS, com criptografia). */
  url: string;
}

function rtmpsFrom(info: NonNullable<LiveStreamRes['cdn']>['ingestionInfo']): { rtmps: string | null; rtmp: string | null } {
  const rtmp = info?.ingestionAddress ?? null;
  let rtmps = info?.rtmpsIngestionAddress ?? null;
  if (!rtmps && rtmp && /^rtmp:\/\/a\.rtmp\.youtube\.com\//.test(rtmp)) rtmps = rtmp.replace('rtmp://a.rtmp.', 'rtmps://a.rtmps.');
  return { rtmps, rtmp };
}

/** A "chave de transmissão" reaproveitável da pessoa (cria na primeira vez). */
export async function ensureStream(env: Env, acc: YtAccount, token: string): Promise<Ingest> {
  if (acc.stream_id && acc.stream_key_enc) {
    const key = await unseal(env, acc.stream_key_enc);
    const r = await yt<{ items?: LiveStreamRes[] }>(env, token, 'GET', '/liveStreams', { part: 'id,cdn', id: acc.stream_id });
    const s = r?.items?.[0];
    const name = s?.cdn?.ingestionInfo?.streamName;
    if (s && name && key === name) {
      const { rtmps, rtmp } = rtmpsFrom(s.cdn?.ingestionInfo);
      if (rtmps !== acc.ingest_rtmps || rtmp !== acc.ingest_rtmp) {
        await env.DB.prepare('UPDATE yt_accounts SET ingest_rtmps = ?, ingest_rtmp = ? WHERE user_id = ?').bind(rtmps, rtmp, acc.user_id).run();
        acc.ingest_rtmps = rtmps;
        acc.ingest_rtmp = rtmp;
      }
      const url = rtmps || rtmp;
      if (url) return { streamId: s.id, key: name, url };
    }
  }
  const s = await yt<LiveStreamRes>(
    env,
    token,
    'POST',
    '/liveStreams',
    { part: 'id,snippet,cdn,contentDetails,status' },
    {
      snippet: { title: 'App da igreja — câmera do celular', description: 'Criada pelo app da igreja para as lives feitas pela câmera do celular.' },
      cdn: { ingestionType: 'rtmp', resolution: 'variable', frameRate: 'variable' },
      contentDetails: { isReusable: true },
    },
  );
  const name = s.cdn?.ingestionInfo?.streamName;
  const { rtmps, rtmp } = rtmpsFrom(s.cdn?.ingestionInfo);
  const url = rtmps || rtmp;
  if (!s.id || !name || !url) throw new YtError(502, 'stream', 'o YouTube não devolveu a chave de transmissão');
  const keyEnc = await seal(env, name);
  await env.DB.prepare('UPDATE yt_accounts SET stream_id = ?, stream_key_enc = ?, ingest_rtmps = ?, ingest_rtmp = ?, updated_at = ? WHERE user_id = ?')
    .bind(s.id, keyEnc, rtmps, rtmp, now(), acc.user_id)
    .run();
  acc.stream_id = s.id;
  acc.stream_key_enc = keyEnc;
  acc.ingest_rtmps = rtmps;
  acc.ingest_rtmp = rtmp;
  return { streamId: s.id, key: name, url };
}

/** Cria a live (transmissão) no canal: começa sozinha quando o vídeo chegar e só termina quando o app mandar. */
export async function createBroadcast(env: Env, token: string, o: { title: string; description: string; privacy: 'public' | 'unlisted' }) {
  const b = await yt<{ id: string }>(
    env,
    token,
    'POST',
    '/liveBroadcasts',
    { part: 'id,snippet,contentDetails,status' },
    {
      snippet: {
        title: o.title.replace(/[<>]/g, '').slice(0, 100) || 'Culto ao vivo',
        description: o.description.replace(/[<>]/g, '').slice(0, 4500),
        scheduledStartTime: new Date().toISOString(),
      },
      status: { privacyStatus: o.privacy, selfDeclaredMadeForKids: false },
      contentDetails: {
        enableAutoStart: true,
        enableAutoStop: false,
        enableDvr: true,
        recordFromStart: true,
        enableEmbed: true,
        monitorStream: { enableMonitorStream: false },
      },
    },
  );
  if (!b?.id) throw new YtError(502, 'broadcast', 'o YouTube não devolveu a live criada');
  return b.id;
}

export async function bindBroadcast(env: Env, token: string, broadcastId: string, streamId: string) {
  await yt(env, token, 'POST', '/liveBroadcasts/bind', { part: 'id,contentDetails', id: broadcastId, streamId });
}

/** Situação da live no YouTube: created, ready, testing, liveStarting, live, complete, revoked… (null = não existe mais). */
export async function broadcastStatus(env: Env, token: string, id: string): Promise<{ life: string; privacy: string } | null> {
  const r = await yt<{ items?: { id: string; status?: { lifeCycleStatus?: string; privacyStatus?: string } }[] }>(
    env,
    token,
    'GET',
    '/liveBroadcasts',
    { part: 'id,status', id },
  );
  const b = r?.items?.[0];
  return b ? { life: b.status?.lifeCycleStatus ?? '', privacy: b.status?.privacyStatus ?? '' } : null;
}

/** Se o vídeo está chegando ao YouTube: active, inactive, ready… e a saúde (good, ok, bad, noData). */
export async function streamStatus(env: Env, token: string, id: string): Promise<{ status: string; health: string } | null> {
  const r = await yt<{ items?: LiveStreamRes[] }>(env, token, 'GET', '/liveStreams', { part: 'id,status', id });
  const s = r?.items?.[0];
  return s ? { status: s.status?.streamStatus ?? '', health: s.status?.healthStatus?.status ?? '' } : null;
}

export async function transition(env: Env, token: string, id: string, to: 'live' | 'complete') {
  await yt(env, token, 'POST', '/liveBroadcasts/transition', { part: 'id,status', id, broadcastStatus: to });
}

/** Termina a live no YouTube: encerra se estiver no ar; apaga se nunca começou. */
export async function finishBroadcast(env: Env, token: string, id: string) {
  const st = await broadcastStatus(env, token, id);
  if (!st || st.life === 'complete' || st.life === 'revoked') return;
  if (st.life === 'live' || st.life === 'liveStarting' || st.life === 'testing' || st.life === 'testStarting') {
    try {
      await transition(env, token, id, 'complete');
    } catch (e) {
      if (!(e instanceof YtError) || (e.reason !== 'redundantTransition' && e.reason !== 'invalidTransition')) throw e;
    }
    return;
  }
  await yt(env, token, 'DELETE', '/liveBroadcasts', { id });
}
