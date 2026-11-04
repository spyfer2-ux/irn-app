// Provedor de login "de mentira" (imita o Google) só para testar o fluxo completo de login localmente.
// Também imita a parte da API do YouTube que a live pela câmera do app usa (canal, chave, criar/ligar/encerrar live).
// Uso: node tests/fake-google.mjs [porta]   — e aponte OIDC_* e YOUTUBE_API_URL no .dev.vars para ele.
// FAKE_RTMP=rtmp://127.0.0.1:19360/live2 → endereço de entrada devolvido para as lives (um servidor RTMP local).
// FAKE_RTMP_OUT=/caminho/recebido.flv → a "live" só entra no ar quando esse arquivo começa a receber vídeo.
import http from 'node:http';
import { statSync } from 'node:fs';
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] || 9555);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = 'teste.apps.googleusercontent.com';
const CLIENT_SECRET = 'segredo-de-teste';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-1', alg: 'RS256', use: 'sig' };
const codes = new Map();
const b64u = (b) => Buffer.from(b).toString('base64url');

// ---------- YouTube de mentira ----------
const RTMP = process.env.FAKE_RTMP || 'rtmp://127.0.0.1:19360/live2';
const STREAM_KEY = process.env.FAKE_STREAM_KEY || 'chave-teste-e2e';
const tokens = new Map(); // access token → e-mail
const refreshTokens = new Map(); // refresh token → e-mail
const yt = { streams: new Map(), broadcasts: new Map(), calls: [], failNext: null };

function streamActive() {
  if (!process.env.FAKE_RTMP_OUT) return true;
  try {
    return statSync(process.env.FAKE_RTMP_OUT).size > 20000;
  } catch {
    return false;
  }
}

function ytError(res, code, reason, message) {
  res.writeHead(code, { 'content-type': 'application/json' }).end(
    JSON.stringify({ error: { code, message, errors: [{ reason, domain: 'youtube.liveBroadcast', message }] } }),
  );
}

async function readBody(req) {
  let raw = '';
  for await (const ch of req) raw += ch;
  return raw ? JSON.parse(raw) : null;
}

async function youtubeApi(req, res, url) {
  const send = (obj, code = 200) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
  const path = url.pathname.replace('/youtube/v3', '');
  const q = url.searchParams;
  if (path === '/_estado') return send({ calls: yt.calls, broadcasts: [...yt.broadcasts.values()] });
  if (path === '/_falhar') {
    yt.failNext = q.get('reason');
    return send({ ok: true });
  }
  const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tokens.has(auth)) return ytError(res, 401, 'authError', 'Invalid Credentials');
  yt.calls.push(`${req.method} ${path} ${q.get('broadcastStatus') || ''}`.trim());
  if (path === '/channels' && req.method === 'GET') {
    return send({ items: [{ id: 'UCteste0000000000000001', snippet: { title: 'Canal do Fernando (teste)', thumbnails: { default: { url: 'https://yt3.ggpht.com/teste=s88' } } } }] });
  }
  if (path === '/liveStreams' && req.method === 'POST') {
    await readBody(req);
    const s = { id: `stream-${yt.streams.size + 1}`, cdn: { ingestionType: 'rtmp', ingestionInfo: { streamName: STREAM_KEY, ingestionAddress: RTMP } } };
    yt.streams.set(s.id, s);
    return send(s);
  }
  if (path === '/liveStreams' && req.method === 'GET') {
    const s = yt.streams.get(q.get('id'));
    if (!s) return send({ items: [] });
    return send({ items: [{ ...s, status: { streamStatus: streamActive() ? 'active' : 'ready', healthStatus: { status: streamActive() ? 'good' : 'noData' } } }] });
  }
  if (path === '/liveBroadcasts' && req.method === 'POST') {
    const b = await readBody(req);
    if (yt.failNext) {
      const reason = yt.failNext;
      yt.failNext = null;
      return ytError(res, 403, reason, 'The user is not enabled for live streaming.');
    }
    const id = b64u(randomBytes(8)).slice(0, 11);
    yt.broadcasts.set(id, { id, title: b.snippet.title, privacy: b.status.privacyStatus, contentDetails: b.contentDetails, life: 'created', bound: null, transitions: [] });
    return send({ id, snippet: b.snippet, status: { lifeCycleStatus: 'created', privacyStatus: b.status.privacyStatus } });
  }
  if (path === '/liveBroadcasts/bind') {
    const b = yt.broadcasts.get(q.get('id'));
    if (!b) return ytError(res, 404, 'liveBroadcastNotFound', 'not found');
    b.bound = q.get('streamId');
    b.life = 'ready';
    return send({ id: b.id });
  }
  if (path === '/liveBroadcasts' && req.method === 'GET') {
    const b = yt.broadcasts.get(q.get('id'));
    if (!b) return send({ items: [] });
    // enableAutoStart: entra no ar sozinha quando o vídeo começa a chegar
    if (b.life === 'ready' && b.contentDetails?.enableAutoStart && streamActive()) b.life = 'live';
    return send({ items: [{ id: b.id, status: { lifeCycleStatus: b.life, privacyStatus: b.privacy } }] });
  }
  if (path === '/liveBroadcasts/transition') {
    const b = yt.broadcasts.get(q.get('id'));
    if (!b) return ytError(res, 404, 'liveBroadcastNotFound', 'not found');
    const to = q.get('broadcastStatus');
    b.transitions.push(to);
    if (to === 'complete') {
      if (b.life !== 'live') return ytError(res, 403, 'invalidTransition', 'invalid transition');
      b.life = 'complete';
    } else if (to === 'live') {
      if (!streamActive()) return ytError(res, 403, 'errorStreamInactive', 'stream inactive');
      b.life = 'live';
    }
    return send({ id: b.id, status: { lifeCycleStatus: b.life } });
  }
  if (path === '/liveBroadcasts' && req.method === 'DELETE') {
    const b = yt.broadcasts.get(q.get('id'));
    if (b) b.life = 'apagada';
    return res.writeHead(204).end();
  }
  return ytError(res, 404, 'notFound', `rota de teste desconhecida: ${req.method} ${path}`);
}

function idToken(claims) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'fake-1', typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER);
    if (url.pathname.startsWith('/youtube/v3/')) return youtubeApi(req, res, url);
    if (url.pathname === '/revoke' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    if (url.pathname === '/auth') {
      const q = url.searchParams;
      if (q.get('client_id') !== CLIENT_ID) return res.writeHead(400).end('client_id errado');
      const code = b64u(randomBytes(12));
      codes.set(code, {
        nonce: q.get('nonce'),
        challenge: q.get('code_challenge'),
        redirect: q.get('redirect_uri'),
        email: q.get('login_hint') || 'fernando.teste@gmail.com',
        scope: q.get('scope') || 'openid email profile',
      });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const ch of req) raw += ch;
      const f = new URLSearchParams(raw);
      if (f.get('grant_type') === 'refresh_token') {
        const email = refreshTokens.get(f.get('refresh_token'));
        if (!email || f.get('client_secret') !== CLIENT_SECRET)
          return res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid_grant' }));
        const access = `at-${b64u(randomBytes(12))}`;
        tokens.set(access, email);
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: access, expires_in: 3599, token_type: 'Bearer' }));
        return;
      }
      const c = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      const fail = (m) => res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: m }));
      if (!c) return fail('invalid_grant');
      if (f.get('client_secret') !== CLIENT_SECRET || f.get('client_id') !== CLIENT_ID) return fail('invalid_client');
      if (f.get('redirect_uri') !== c.redirect) return fail('redirect_uri_mismatch');
      const expected = createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
      if (expected !== c.challenge) return fail('pkce');
      const now = Math.floor(Date.now() / 1000);
      const token = idToken({
        iss: ISSUER,
        aud: CLIENT_ID,
        sub: createHash('sha1').update(c.email).digest('hex').slice(0, 21),
        email: c.email,
        email_verified: true,
        name: 'Fernando Teste',
        picture: 'https://lh3.googleusercontent.com/a/teste',
        nonce: c.nonce,
        iat: now,
        exp: now + 3600,
      });
      const access = `at-${b64u(randomBytes(12))}`;
      const refresh = `rt-${b64u(randomBytes(12))}`;
      tokens.set(access, c.email);
      refreshTokens.set(refresh, c.email);
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ id_token: token, access_token: access, refresh_token: refresh, expires_in: 3599, scope: c.scope, token_type: 'Bearer' }),
      );
      return;
    }
    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`google de teste em ${ISSUER}`));
