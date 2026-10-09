/**
 * Login com Google (OpenID Connect, fluxo "authorization code" com PKCE) e sessões.
 * Precisa de GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET configurados no Worker.
 */
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Ctx, Env, User } from './types';
import {
  auditLog,
  b64urlToBytes,
  body,
  bool,
  bytesToB64url,
  dateStr,
  fail,
  fromUtf8,
  needUser,
  now,
  originOf,
  randomToken,
  rateLimit,
  sha256Hex,
  str,
  utf8,
} from './util';
import { notifyNow } from './push';

const SESSION_COOKIE = 'irn_s';
const OAUTH_COOKIE = 'irn_o';
const SESSION_DAYS = 180;
const DAY = 86400000;

const GOOGLE = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  jwks: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
};

function provider(env: Env) {
  return {
    auth: env.OIDC_AUTH_URL || GOOGLE.auth,
    token: env.OIDC_TOKEN_URL || GOOGLE.token,
    jwks: env.OIDC_JWKS_URL || GOOGLE.jwks,
    issuers: env.OIDC_ISSUER ? [env.OIDC_ISSUER] : GOOGLE.issuers,
  };
}

export function googleConfigured(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

// ---------------- sessão ----------------

export async function loadUser(c: Ctx): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    'SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  )
    .bind(hash)
    .first<User & { s_exp: number }>();
  if (!row) return null;
  const t = now();
  if (row.s_exp < t) {
    c.executionCtx.waitUntil(c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run());
    return null;
  }
  // Renova a sessão (e o "visto por último") no máximo uma vez a cada 12 horas.
  if (!row.last_seen_at || t - row.last_seen_at > DAY / 2) {
    c.executionCtx.waitUntil(
      c.env.DB.batch([
        c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(t, row.id),
        c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(t + SESSION_DAYS * DAY, hash),
      ]),
    );
    setCookie(c, SESSION_COOKIE, token, cookieOpts(SESSION_DAYS * 86400));
  }
  const { s_exp: _ignored, ...user } = row;
  return user as User;
}

function cookieOpts(maxAge: number, path = '/') {
  return { httpOnly: true, secure: true, sameSite: 'Lax' as const, path, maxAge };
}

async function createSession(c: Ctx, userId: number) {
  const token = randomToken(32);
  const t = now();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(await sha256Hex(token), userId, t, t + SESSION_DAYS * DAY, (c.req.header('user-agent') ?? '').slice(0, 200))
    .run();
  setCookie(c, SESSION_COOKIE, token, cookieOpts(SESSION_DAYS * 86400));
}

function safeReturn(v: string | undefined | null): string {
  if (!v || typeof v !== 'string' || v.length > 300) return '/';
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\') || v.startsWith('/api/')) return '/';
  return v;
}

// ---------------- verificação do ID token ----------------

interface Jwk extends JsonWebKey {
  kid?: string;
}
let jwksCache: { keys: Jwk[]; exp: number; url: string } | null = null;

async function getJwk(env: Env, kid: string): Promise<Jwk | undefined> {
  const url = provider(env).jwks;
  const fresh = jwksCache && jwksCache.url === url && jwksCache.exp > now();
  if (!fresh || !jwksCache!.keys.some((k) => k.kid === kid)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Não consegui buscar as chaves do Google');
    const j = (await res.json()) as { keys: Jwk[] };
    jwksCache = { keys: j.keys ?? [], exp: now() + 3600_000, url };
  }
  return jwksCache!.keys.find((k) => k.kid === kid);
}

export interface IdClaims {
  iss: string;
  aud: string;
  sub: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  nonce?: string;
  exp: number;
  iat: number;
}

export async function verifyIdToken(env: Env, idToken: string, nonce: string): Promise<IdClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('token malformado');
  const header = JSON.parse(fromUtf8(b64urlToBytes(parts[0]))) as { alg: string; kid: string };
  const claims = JSON.parse(fromUtf8(b64urlToBytes(parts[1]))) as IdClaims;
  if (header.alg !== 'RS256') throw new Error('algoritmo inesperado');
  const jwk = await getJwk(env, header.kid);
  if (!jwk) throw new Error('chave do token desconhecida');
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new Error('assinatura inválida');
  const t = Math.floor(now() / 1000);
  if (!provider(env).issuers.includes(claims.iss)) throw new Error('emissor inválido');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('token de outro aplicativo');
  if (typeof claims.exp !== 'number' || claims.exp < t - 60) throw new Error('token expirado');
  if (typeof claims.iat === 'number' && claims.iat > t + 300) throw new Error('token do futuro');
  if (claims.nonce !== nonce) throw new Error('nonce inválido');
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === 'true'))
    throw new Error('e-mail não verificado');
  return claims;
}

// ---------------- cadastro ----------------

function adminEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function upsertUser(c: Ctx, info: { sub: string | null; email: string; name: string; picture: string | null }) {
  const env = c.env;
  const email = info.email.toLowerCase();
  const t = now();
  let u = await env.DB.prepare(
    'SELECT * FROM users WHERE (google_sub IS NOT NULL AND google_sub = ?) OR email = ? ORDER BY (google_sub = ?) DESC LIMIT 1',
  )
    .bind(info.sub, email, info.sub)
    .first<User>();
  let isNew = false;
  if (!u) {
    u = await env.DB.prepare(
      'INSERT INTO users (google_sub, email, name, picture, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
      .bind(info.sub, email, info.name, info.picture, t, t)
      .first<User>();
    isNew = true;
  } else {
    await env.DB.prepare(
      "UPDATE users SET google_sub = COALESCE(?, google_sub), picture = COALESCE(?, picture), name = CASE WHEN name = '' THEN ? ELSE name END, last_seen_at = ? WHERE id = ?",
    )
      .bind(info.sub, info.picture, info.name, t, u.id)
      .run();
  }
  const admins = adminEmails(env);
  if (admins.includes(email)) {
    await env.DB.prepare(
      "UPDATE users SET role = 'admin', status = 'aprovado', approved_at = COALESCE(approved_at, ?) WHERE id = ?",
    )
      .bind(t, u!.id)
      .run();
  } else if (admins.length === 0) {
    // Sem lista de administradores: a primeira pessoa a entrar vira administradora.
    await env.DB.prepare(
      "UPDATE users SET role = 'admin', status = 'aprovado', approved_at = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND status = 'aprovado')",
    )
      .bind(t, u!.id)
      .run();
  }
  const fresh = (await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u!.id).first<User>())!;
  if (isNew) {
    if (fresh.status === 'pendente') {
      await notifyNow(env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
        topic: 'admin',
        audience: 'admins',
        title: 'Novo cadastro aguardando aprovação',
        body: `${fresh.name} (${fresh.email}) quer entrar no app.`,
        url: '/admin/membros?status=pendente',
      });
    }
    await auditLog(c, fresh.id, 'cadastro', `${fresh.email} → ${fresh.status}/${fresh.role}`).run();
  }
  return fresh;
}

// ---------------- rotas ----------------

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/google/start', async (c) => {
  if (!googleConfigured(c.env)) return c.redirect('/entrar?erro=config');
  const ret = safeReturn(c.req.query('voltar'));
  const state = randomToken(16);
  const verifier = randomToken(32);
  const nonce = randomToken(16);
  const challenge = bytesToB64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
  setCookie(c, OAUTH_COOKIE, [state, verifier, nonce, bytesToB64url(utf8(ret))].join('.'), cookieOpts(600, '/api/auth'));
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${originOf(c)}/api/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return c.redirect(`${provider(c.env).auth}?${params}`);
});

authRoutes.get('/google/callback', async (c) => {
  const q = c.req.query();
  const cookie = getCookie(c, OAUTH_COOKIE) ?? '';
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth', secure: true });
  if (q.error) return c.redirect(`/entrar?erro=${q.error === 'access_denied' ? 'cancelado' : 'google'}`);
  const [state, verifier, nonce, retB64] = cookie.split('.');
  if (!state || !q.state || state !== q.state || !q.code) return c.redirect('/entrar?erro=expirou');
  let ret = '/';
  try {
    ret = safeReturn(fromUtf8(b64urlToBytes(retB64 ?? '')));
  } catch {
    /* mantém "/" */
  }
  try {
    const res = await fetch(provider(c.env).token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: c.env.GOOGLE_CLIENT_ID!,
        client_secret: c.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: `${originOf(c)}/api/auth/google/callback`,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!res.ok) {
      console.error('troca de código falhou', res.status, (await res.text()).slice(0, 300));
      return c.redirect('/entrar?erro=google');
    }
    const tok = (await res.json()) as { id_token?: string };
    if (!tok.id_token) return c.redirect('/entrar?erro=google');
    const claims = await verifyIdToken(c.env, tok.id_token, nonce);
    const name = (typeof claims.name === 'string' && claims.name.trim()) || claims.email!.split('@')[0];
    const picture = typeof claims.picture === 'string' && claims.picture.startsWith('https://') ? claims.picture : null;
    const user = await upsertUser(c, { sub: claims.sub, email: claims.email!, name: name.slice(0, 120), picture });
    if (user.status === 'bloqueado') return c.redirect('/entrar?erro=bloqueado');
    await createSession(c, user.id);
    return c.redirect(user.status === 'aprovado' ? ret : '/aguardando');
  } catch (e) {
    console.error('login google', String(e));
    return c.redirect('/entrar?erro=google');
  }
});

/** Login de teste: só existe quando DEV_LOGIN=1 E o endereço é localhost. */
authRoutes.post('/dev', async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.DEV_LOGIN !== '1' || !['localhost', '127.0.0.1'].includes(host)) fail(404, 'Não encontrado.');
  const b = await body(c);
  const email = str(b.email, 200, { required: true, label: 'e-mail' })!.toLowerCase();
  const name = str(b.name, 120) ?? email.split('@')[0];
  const user = await upsertUser(c, { sub: null, email, name, picture: null });
  if (typeof b.role === 'string' || typeof b.status === 'string') {
    await c.env.DB.prepare('UPDATE users SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ?')
      .bind(typeof b.role === 'string' ? b.role : null, typeof b.status === 'string' ? b.status : null, user.id)
      .run();
  }
  await createSession(c, user.id);
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---------------- meu perfil ----------------

export function meView(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    role: u.role,
    status: u.status,
    phone: u.phone,
    birthday: u.birthday,
    show_birthday: u.show_birthday,
    neighborhood: u.neighborhood,
    baptized: u.baptized,
    member_since: u.member_since,
    intro: u.intro,
    accepted_terms_at: u.accepted_terms_at,
    created_at: u.created_at,
  };
}

export const meRoutes = new Hono<AppEnv>();

meRoutes.get('/', (c) => {
  const u = c.get('user');
  return c.json({ user: u ? meView(u) : null });
});

meRoutes.put('/', async (c) => {
  const u = needUser(c);
  await rateLimit(c.env, `perfil:${u.id}`, 30, 3600_000);
  const b = await body(c);
  const name = str(b.name, 120, { label: 'nome' }) ?? u.name;
  const phone = str(b.phone, 30, { label: 'telefone' });
  if (phone && !/^[\d\s()+-]{8,30}$/.test(phone)) fail(400, 'Telefone inválido.');
  const birthday = dateStr(b.birthday, 'aniversário');
  const memberSince = str(b.member_since, 20, { label: 'membro desde' });
  const acceptTerms = bool(b.accept_terms);
  await c.env.DB.prepare(
    `UPDATE users SET name = ?, phone = ?, birthday = ?, show_birthday = ?, neighborhood = ?, baptized = ?,
       member_since = ?, intro = ?, accepted_terms_at = CASE WHEN ? THEN COALESCE(accepted_terms_at, ?) ELSE accepted_terms_at END
     WHERE id = ?`,
  )
    .bind(
      name,
      phone,
      birthday,
      b.show_birthday === undefined ? u.show_birthday : bool(b.show_birthday) ? 1 : 0,
      str(b.neighborhood, 80, { label: 'bairro' }),
      b.baptized === undefined || b.baptized === null || b.baptized === '' ? null : bool(b.baptized) ? 1 : 0,
      memberSince,
      str(b.intro, 600, { label: 'apresentação' }),
      acceptTerms ? 1 : 0,
      now(),
      u.id,
    )
    .run();
  const fresh = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<User>();
  return c.json({ user: meView(fresh!) });
});

/** Exclusão da conta pela própria pessoa (LGPD). */
meRoutes.post('/excluir', async (c) => {
  const u = needUser(c);
  const b = await body(c);
  if (b.confirm !== 'EXCLUIR') fail(400, 'Digite EXCLUIR para confirmar.');
  await deleteUserCascade(c.env, u.id, u.name);
  await auditLog(c, null, 'conta_excluida', `${u.email} excluiu a própria conta`).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

/** Apaga a pessoa e o que é pessoal dela. Fotos da biblioteca e registros financeiros ficam, sem o vínculo. */
export async function deleteUserCascade(env: Env, userId: number, name: string) {
  const stmts = [
    'DELETE FROM sessions WHERE user_id = ?',
    'DELETE FROM push_subs WHERE user_id = ?',
    'DELETE FROM event_rsvps WHERE user_id = ?',
    'DELETE FROM prayer_marks WHERE user_id = ?',
    'DELETE FROM prayer_marks WHERE prayer_id IN (SELECT id FROM prayers WHERE user_id = ?)',
    'DELETE FROM prayers WHERE user_id = ?',
    'DELETE FROM testimony_amens WHERE user_id = ?',
    'DELETE FROM testimony_amens WHERE testimony_id IN (SELECT id FROM testimonies WHERE user_id = ?)',
    'DELETE FROM testimonies WHERE user_id = ?',
    'DELETE FROM campaign_members WHERE user_id = ?',
    'DELETE FROM campaign_checkins WHERE user_id = ?',
    'DELETE FROM ministry_requests WHERE user_id = ?',
    'UPDATE photos SET uploaded_by = NULL WHERE uploaded_by = ?',
  ].map((sql) => env.DB.prepare(sql).bind(userId));
  stmts.push(
    env.DB.prepare('UPDATE contributions SET donor_name = COALESCE(donor_name, ?), user_id = NULL WHERE user_id = ?').bind(
      name,
      userId,
    ),
  );
  stmts.push(env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId));
  await env.DB.batch(stmts);
}

