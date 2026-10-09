// Provedor de login "de mentira" (imita o Google) só para testar o fluxo completo de login localmente.
// Uso: node tests/fake-google.mjs [porta]   — e aponte OIDC_* no .dev.vars para ele.
import http from 'node:http';
import { createHash, generateKeyPairSync, createSign, randomBytes } from 'node:crypto';

const PORT = Number(process.argv[2] || 9555);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = 'teste.apps.googleusercontent.com';
const CLIENT_SECRET = 'segredo-de-teste';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fake-1', alg: 'RS256', use: 'sig' };
const codes = new Map();
const b64u = (b) => Buffer.from(b).toString('base64url');

function idToken(claims) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid: 'fake-1', typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, ISSUER);
    if (url.pathname === '/auth') {
      const q = url.searchParams;
      if (q.get('client_id') !== CLIENT_ID) return res.writeHead(400).end('client_id errado');
      const code = b64u(randomBytes(12));
      codes.set(code, {
        nonce: q.get('nonce'),
        challenge: q.get('code_challenge'),
        redirect: q.get('redirect_uri'),
        email: q.get('login_hint') || 'fernando.teste@gmail.com',
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
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id_token: token, access_token: 'x', token_type: 'Bearer' }));
      return;
    }
    if (url.pathname === '/jwks') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
      return;
    }
    res.writeHead(404).end();
  })
  .listen(PORT, '127.0.0.1', () => console.log(`google de teste em ${ISSUER}`));
