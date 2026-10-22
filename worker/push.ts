/**
 * Notificações no celular (Web Push), sem serviço pago:
 * - As chaves VAPID são criadas sozinhas no primeiro uso e ficam guardadas no banco.
 * - O conteúdo vai criptografado (RFC 8291 / aes128gcm), como exigem Chrome, Safari e Firefox.
 * - O envio é feito em lotes pequenos (até 20 por vez), para caber no limite de tempo de processamento e de
 *   chamadas por requisição do plano grátis da Cloudflare. O resto sai no próximo lote (o app de quem publicou
 *   ajuda a enviar mais rápido, e a tarefa automática termina de enviar a cada 5 minutos).
 */
import { Hono } from 'hono';
import type { AppEnv, Env, User } from './types';
import {
  b64urlToBytes,
  body,
  bytesToB64url,
  fail,
  isAdmin,
  isLeader,
  isMedia,
  isMember,
  needMedia,
  now,
  originOf,
  utf8,
} from './util';

export const PUBLIC_TOPICS = ['lives', 'cultos', 'eventos', 'palavra', 'avisos'] as const;
export const MEMBER_TOPICS = ['fotos', 'oracao'] as const;
const ALL_TOPICS: readonly string[] = [...PUBLIC_TOPICS, ...MEMBER_TOPICS];
/** Tópicos que sempre chegam (não dependem da escolha da pessoa). */
const ALWAYS = ['pessoal', 'admin'];

const PUSH_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

// ---------------- chaves VAPID ----------------

export interface Vapid {
  publicKey: string;
  privateJwk: JsonWebKey;
}
let vapidCache: Vapid | null = null;

export async function getVapid(env: Env): Promise<Vapid> {
  if (vapidCache) return vapidCache;
  const read = () => env.DB.prepare("SELECT value FROM settings WHERE key = 'vapid'").first<{ value: string }>();
  let row = await read();
  if (!row) {
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const pub = new Uint8Array((await crypto.subtle.exportKey('raw', kp.publicKey)) as ArrayBuffer);
    const jwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
    const v: Vapid = { publicKey: bytesToB64url(pub), privateJwk: jwk };
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('vapid', ?, ?) ON CONFLICT(key) DO NOTHING")
      .bind(JSON.stringify(v), now())
      .run();
    row = await read();
  }
  vapidCache = JSON.parse(row!.value) as Vapid;
  return vapidCache;
}

// ---------------- criptografia (RFC 8291) ----------------

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

export interface EncryptOptions {
  /** Só para testes: chaves e salt fixos. */
  asKeyPair?: CryptoKeyPair;
  salt?: Uint8Array;
}

export async function encryptPayload(
  p256dh: string,
  authSecret: string,
  plaintext: Uint8Array,
  opts: EncryptOptions = {},
): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(p256dh);
  const auth = b64urlToBytes(authSecret);
  if (uaPublic.length !== 65 || auth.length < 16) throw new Error('Chaves de inscrição inválidas');
  const asKeys =
    opts.asKeyPair ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', asKeys.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asKeys.privateKey, 256),
  );
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const prkKey = await hmac(auth, ecdhSecret);
  const keyInfo = concat(utf8('WebPush: info'), [0], uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, [1]));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8('Content-Encoding: aes128gcm'), [0], [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8('Content-Encoding: nonce'), [0], [1]))).slice(0, 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, [2])),
  );
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// ---------------- assinatura VAPID (JWT ES256) ----------------

const jwtCache = new Map<string, { value: string; exp: number }>();

export async function vapidHeader(endpoint: string, vapid: Vapid, subject: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const cached = jwtCache.get(aud);
  const t = Math.floor(now() / 1000);
  if (cached && cached.exp - t > 600) return `vapid t=${cached.value}, k=${vapid.publicKey}`;
  const exp = t + 12 * 3600;
  const enc = (o: unknown) => bytesToB64url(utf8(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(unsigned)));
  const token = `${unsigned}.${bytesToB64url(sig)}`;
  jwtCache.set(aud, { value: token, exp });
  return `vapid t=${token}, k=${vapid.publicKey}`;
}

interface SubRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

async function sendOne(
  vapid: Vapid,
  subject: string,
  sub: SubRow,
  payload: string,
  urgency: string,
  ttl: number,
): Promise<'ok' | 'gone' | 'fail'> {
  try {
    const bodyBytes = await encryptPayload(sub.p256dh, sub.auth, utf8(payload));
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(sub.endpoint, vapid, subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttl),
        Urgency: urgency === 'high' ? 'high' : 'normal',
      },
      body: bodyBytes,
      // Aparelho fora do ar não pode segurar o envio dos outros: desiste em 10s e tenta de novo depois.
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    if (res.ok) return 'ok';
    console.warn('push falhou', res.status, (await res.text()).slice(0, 200));
    return 'fail';
  } catch (e) {
    console.warn('push erro', String(e));
    return 'fail';
  }
}

// ---------------- fila de envio ----------------

export interface NotifyInput {
  topic: string;
  audience: 'all' | 'members' | 'media' | 'leaders' | 'admins' | `user:${number}`;
  title: string;
  body?: string | null;
  url?: string | null;
  urgency?: 'high' | 'normal';
  createdBy?: number | null;
}

export async function notify(env: Env, n: NotifyInput): Promise<number> {
  const row = await env.DB.prepare(
    'INSERT INTO notifications (topic, audience, title, body, url, urgency, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(
      n.topic,
      n.audience,
      n.title.slice(0, 120),
      (n.body ?? '').slice(0, 300) || null,
      n.url ?? null,
      n.urgency ?? 'normal',
      n.createdBy ?? null,
      now(),
    )
    .first<{ id: number }>();
  return row!.id;
}

interface NotifRow {
  id: number;
  topic: string;
  audience: string;
  title: string;
  body: string | null;
  url: string | null;
  urgency: string;
  cursor: number;
}

function audienceSql(n: NotifRow): { where: string; binds: unknown[] } {
  const binds: unknown[] = [];
  let where = '';
  if (n.audience.startsWith('user:')) {
    where += ' AND p.user_id = ?';
    binds.push(Number(n.audience.slice(5)));
  } else if (n.audience === 'members') {
    where += " AND u.status = 'aprovado'";
  } else if (n.audience === 'media') {
    where += " AND u.status = 'aprovado' AND u.role IN ('midia','lider','admin')";
  } else if (n.audience === 'leaders') {
    where += " AND u.status = 'aprovado' AND u.role IN ('lider','admin')";
  } else if (n.audience === 'admins') {
    where += " AND u.status = 'aprovado' AND u.role = 'admin'";
  } else {
    // 'all': visitantes e membros, menos quem foi bloqueado
    where += " AND (u.id IS NULL OR u.status != 'bloqueado')";
  }
  if (!n.audience.startsWith('user:') && !ALWAYS.includes(n.topic)) {
    where += " AND (',' || p.topics || ',') LIKE ?";
    binds.push(`%,${n.topic},%`);
  }
  return { where, binds };
}

/**
 * Envia notificações pendentes, no máximo `budget` envios nesta chamada.
 * Pode rodar ao mesmo tempo em vários lugares sem mandar duas vezes para a mesma pessoa:
 * cada lote é "reservado" avançando o cursor antes do envio.
 */
export async function drain(env: Env, origin: string, budget = 20): Promise<{ sent: number; remaining: number }> {
  let sent = 0;
  let guard = 0;
  const vapid = await getVapid(env);
  while (budget > 0 && guard++ < 20) {
    const n = await env.DB.prepare('SELECT * FROM notifications WHERE done = 0 ORDER BY id LIMIT 1').first<NotifRow>();
    if (!n) break;
    const limit = Math.min(budget, 20);
    const { where, binds } = audienceSql(n);
    const { results: subs } = await env.DB.prepare(
      `SELECT p.id, p.endpoint, p.p256dh, p.auth FROM push_subs p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.id > ?${where} ORDER BY p.id LIMIT ?`,
    )
      .bind(n.cursor, ...binds, limit)
      .all<SubRow>();
    const last = subs.length ? subs[subs.length - 1].id : n.cursor;
    const finished = subs.length < limit ? 1 : 0;
    const claim = await env.DB.prepare('UPDATE notifications SET cursor = ?, done = ? WHERE id = ? AND cursor = ? AND done = 0')
      .bind(last, finished, n.id, n.cursor)
      .run();
    if (!claim.meta.changes) continue; // outro processo pegou este lote
    if (!subs.length) continue;

    const payload = JSON.stringify({
      title: n.title,
      body: n.body ?? '',
      url: n.url || '/',
      tag: `${n.topic}-${n.id}`,
    });
    const ttl = n.topic === 'lives' ? 3 * 3600 : 24 * 3600;
    const results = await Promise.all(subs.map((s) => sendOne(vapid, origin, s, payload, n.urgency, ttl)));
    budget -= subs.length;

    const okIds = subs.filter((_, i) => results[i] === 'ok').map((s) => s.id);
    const goneIds = subs.filter((_, i) => results[i] === 'gone').map((s) => s.id);
    const failIds = subs.filter((_, i) => results[i] === 'fail').map((s) => s.id);
    sent += okIds.length;
    const stmts: D1PreparedStatement[] = [
      env.DB.prepare('UPDATE notifications SET sent = sent + ?, failed = failed + ? WHERE id = ?').bind(
        okIds.length,
        goneIds.length + failIds.length,
        n.id,
      ),
    ];
    if (okIds.length)
      stmts.push(
        env.DB.prepare(
          `UPDATE push_subs SET last_ok_at = ?, fail_count = 0 WHERE id IN (${okIds.map(() => '?').join(',')})`,
        ).bind(now(), ...okIds),
      );
    if (goneIds.length)
      stmts.push(env.DB.prepare(`DELETE FROM push_subs WHERE id IN (${goneIds.map(() => '?').join(',')})`).bind(...goneIds));
    if (failIds.length) {
      stmts.push(
        env.DB.prepare(
          `UPDATE push_subs SET fail_count = fail_count + 1 WHERE id IN (${failIds.map(() => '?').join(',')})`,
        ).bind(...failIds),
      );
      stmts.push(env.DB.prepare('DELETE FROM push_subs WHERE fail_count >= 8'));
    }
    await env.DB.batch(stmts);
  }
  const rem = await env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE done = 0').first<{ n: number }>();
  return { sent, remaining: rem?.n ?? 0 };
}

/** Cria a notificação e já começa a enviar em segundo plano. */
export async function notifyNow(
  env: Env,
  origin: string,
  waitUntil: (p: Promise<unknown>) => void,
  n: NotifyInput,
): Promise<number> {
  const id = await notify(env, n);
  waitUntil(drain(env, origin, 15).catch((e) => console.error('drain', e)));
  return id;
}

// ---------------- rotas ----------------

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.get('/key', async (c) => {
  const v = await getVapid(c.env);
  return c.json({ publicKey: v.publicKey, topics: ALL_TOPICS });
});

function cleanTopics(v: unknown, user: User | null): string {
  const list = Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [...PUBLIC_TOPICS];
  const allowed = isMember(user) ? ALL_TOPICS : PUBLIC_TOPICS;
  return [...new Set(list.filter((t) => (allowed as readonly string[]).includes(t)))].join(',');
}

pushRoutes.post('/subscribe', async (c) => {
  const b = await body(c);
  const sub = b.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined;
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
  const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
  const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
  let host = '';
  try {
    const u = new URL(endpoint);
    if (u.protocol === 'https:') host = u.hostname;
  } catch {
    /* inválido */
  }
  if (!host || !PUSH_HOSTS.some((h) => host === h || host.endsWith('.' + h)) || endpoint.length > 800)
    fail(400, 'Este navegador usa um serviço de notificações que não é aceito.');
  if (!p256dh || !auth || p256dh.length > 200 || auth.length > 64) fail(400, 'Inscrição de notificação inválida.');
  const user = c.get('user');
  const topics = cleanTopics(b.topics, user);
  await c.env.DB.prepare(
    `INSERT INTO push_subs (endpoint, p256dh, auth, user_id, topics, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
       user_id = COALESCE(excluded.user_id, push_subs.user_id), topics = excluded.topics, fail_count = 0`,
  )
    .bind(endpoint, p256dh, auth, user?.id ?? null, topics, (c.req.header('user-agent') ?? '').slice(0, 200), now())
    .run();
  return c.json({ ok: true, topics: topics ? topics.split(',') : [] });
});

pushRoutes.post('/status', async (c) => {
  const b = await body(c);
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const row = await c.env.DB.prepare('SELECT topics FROM push_subs WHERE endpoint = ?').bind(endpoint).first<{ topics: string }>();
  return c.json({ subscribed: !!row, topics: row?.topics ? row.topics.split(',') : [] });
});

/** Ao sair da conta: o aparelho continua recebendo avisos públicos, mas deixa de receber os pessoais e os de membros. */
pushRoutes.post('/unlink', async (c) => {
  const b = await body(c);
  if (typeof b.endpoint === 'string') {
    const row = await c.env.DB.prepare('SELECT topics FROM push_subs WHERE endpoint = ?').bind(b.endpoint).first<{ topics: string }>();
    if (row) {
      const topics = row.topics
        .split(',')
        .filter((t) => (PUBLIC_TOPICS as readonly string[]).includes(t))
        .join(',');
      await c.env.DB.prepare('UPDATE push_subs SET user_id = NULL, topics = ? WHERE endpoint = ?').bind(topics, b.endpoint).run();
    }
  }
  return c.json({ ok: true });
});

pushRoutes.post('/unsubscribe', async (c) => {
  const b = await body(c);
  if (typeof b.endpoint === 'string') await c.env.DB.prepare('DELETE FROM push_subs WHERE endpoint = ?').bind(b.endpoint).run();
  return c.json({ ok: true });
});

/** Quem publicou algo pode "ajudar" a enviar mais rápido: o app chama isto até acabar a fila. */
pushRoutes.post('/drain', async (c) => {
  needMedia(c);
  const r = await drain(c.env, originOf(c), 20);
  return c.json(r);
});

/** Caixa de notificações dentro do app. */
pushRoutes.get('/inbox', async (c) => {
  const u = c.get('user');
  const aud = ['all'];
  if (isMember(u)) aud.push('members');
  if (isMedia(u)) aud.push('media');
  if (isLeader(u)) aud.push('leaders');
  if (isAdmin(u)) aud.push('admins');
  if (u) aud.push(`user:${u.id}`);
  const since = now() - 45 * 86400000;
  const { results } = await c.env.DB.prepare(
    `SELECT id, topic, title, body, url, created_at FROM notifications
     WHERE created_at > ? AND audience IN (${aud.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 40`,
  )
    .bind(since, ...aud)
    .all();
  return c.json({ items: results });
});
