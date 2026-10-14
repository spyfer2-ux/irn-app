/**
 * Testes das partes mais delicadas (rodam no Node): criptografia das notificações, assinatura VAPID,
 * verificação do login do Google, código PIX, valores em reais, datas de São Paulo e links do YouTube.
 * Rodar: npx tsx --test tests/unit.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createPublicKey, randomBytes, verify as nodeVerify } from 'node:crypto';
import { createRequire } from 'node:module';
import { encryptPayload, vapidHeader, type Vapid } from '../worker/push';
import { verifyIdToken } from '../worker/auth';
import { parseAmount } from '../worker/routes/giving';
import { youtubeId } from '../worker/routes/videos';
import { nextCults, spParts, spToMs, b64urlToBytes, bytesToB64url } from '../worker/util';
import { crc16, pixPayload } from '../src/lib/pix';
import type { Env } from '../worker/types';

const require = createRequire(import.meta.url);
const ece = require('http_ece');

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');

test('notificação: o celular consegue abrir o conteúdo criptografado (aes128gcm)', async () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const auth = randomBytes(16);
  const message = JSON.stringify({ title: 'AO VIVO: Culto de Domingo', body: 'Acentuação: ção, ê, ü', url: '/ao-vivo' });
  const body = await encryptPayload(b64u(receiver.getPublicKey()), b64u(auth), new TextEncoder().encode(message));
  const plain = ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: receiver, authSecret: b64u(auth) });
  assert.equal(plain.toString('utf8'), message);
  // cabeçalho: salt(16) + rs(4) = 4096 + idlen(1) = 65 + chave pública (65)
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  assert.equal(body[20], 65);
});

test('notificação: assinatura VAPID (ES256) é válida e aponta para o serviço certo', async () => {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const vapid: Vapid = {
    publicKey: b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
  const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vapid, 'https://irn.exemplo.com');
  const m = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(m, header);
  const [h, p, s] = m![1].split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://irn.exemplo.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);
  const pub = createPublicKey({ key: { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)) } as never, format: 'jwk' });
  const ok = nodeVerify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'assinatura ES256 inválida');
  assert.equal(m![2], vapid.publicKey);
});

test('login: aceita só o token certo do Google', async () => {
  const kp = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const env = { GOOGLE_CLIENT_ID: 'cliente.apps.googleusercontent.com', OIDC_JWKS_URL: 'https://teste/jwks' } as unknown as Env;
  const sign = async (claims: Record<string, unknown>, kid = 'k1') => {
    const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
    const unsigned = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc(claims)}`;
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(unsigned)));
    return `${unsigned}.${bytesToB64url(sig)}`;
  };
  const now = Math.floor(Date.now() / 1000);
  const good = {
    iss: 'https://accounts.google.com',
    aud: 'cliente.apps.googleusercontent.com',
    sub: '1234567890',
    email: 'maria@gmail.com',
    email_verified: true,
    name: 'Maria',
    nonce: 'n1',
    iat: now,
    exp: now + 3600,
  };
  try {
    const c = await verifyIdToken(env, await sign(good), 'n1');
    assert.equal(c.email, 'maria@gmail.com');
    await assert.rejects(verifyIdToken(env, await sign(good), 'outro-nonce'), /nonce/);
    await assert.rejects(verifyIdToken(env, await sign({ ...good, aud: 'outro-app' }), 'n1'), /outro aplicativo/);
    await assert.rejects(verifyIdToken(env, await sign({ ...good, exp: now - 3600 }), 'n1'), /expirado/);
    await assert.rejects(verifyIdToken(env, await sign({ ...good, iss: 'https://falso.com' }), 'n1'), /emissor/);
    await assert.rejects(verifyIdToken(env, await sign({ ...good, email_verified: false }), 'n1'), /não verificado/);
    const t = await sign(good);
    const tampered = t.split('.');
    tampered[1] = bytesToB64url(new TextEncoder().encode(JSON.stringify({ ...good, email: 'hacker@gmail.com' })));
    await assert.rejects(verifyIdToken(env, tampered.join('.'), 'n1'), /assinatura/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('PIX: CRC16 confere com o exemplo do Banco Central', () => {
  const ex = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
  assert.equal(crc16(ex.slice(0, -4)), '1D3D');
});

function parseTlv(s: string) {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

test('PIX: copia e cola montado corretamente (chave, nome, cidade, valor, CRC)', () => {
  const code = pixPayload({ key: 'pix@exemplo.com', name: 'Ronaldo Nogueira', city: 'São Paulo', amountCents: 15050, txid: 'Dízimo', description: 'Dízimo IRN' });
  const f = parseTlv(code);
  assert.equal(f['00'], '01');
  const acc = parseTlv(f['26']);
  assert.equal(acc['00'], 'br.gov.bcb.pix');
  assert.equal(acc['01'], 'pix@exemplo.com');
  assert.equal(acc['02'], 'Dizimo IRN');
  assert.equal(f['53'], '986');
  assert.equal(f['54'], '150.50');
  assert.equal(f['58'], 'BR');
  assert.equal(f['59'], 'RONALDO NOGUEIRA');
  assert.equal(f['60'], 'SAO PAULO');
  assert.equal(parseTlv(f['62'])['05'], 'DIZIMO');
  assert.equal(code.slice(-4), crc16(code.slice(0, -4)));
  const noAmount = parseTlv(pixPayload({ key: '+5511999998888', name: 'X', city: 'Y' }));
  assert.equal(noAmount['54'], undefined);
  assert.equal(parseTlv(noAmount['62'])['05'], '***');
});

test('dízimos: entende valores escritos de vários jeitos', () => {
  assert.equal(parseAmount('150'), 15000);
  assert.equal(parseAmount('150,50'), 15050);
  assert.equal(parseAmount('1.250,00'), 125000);
  assert.equal(parseAmount('1.250'), 125000);
  assert.equal(parseAmount('R$ 80'), 8000);
  assert.equal(parseAmount('10.5'), 1050);
  assert.equal(parseAmount(2500), 2500);
  assert.throws(() => parseAmount('abc'));
  assert.throws(() => parseAmount('-5'));
  assert.throws(() => parseAmount('0'));
});

test('horários: datas e cultos no fuso de São Paulo', () => {
  assert.equal(new Date(spToMs('2026-10-11', '18:30')).toISOString(), '2026-10-11T21:30:00.000Z');
  const p = spParts(Date.parse('2026-10-10T02:30:00Z'));
  assert.equal(p.ymd, '2026-10-09');
  assert.equal(p.hour, 23);
  const schedule = [
    { id: 'dom', weekday: 0, time: '18:30', title: 'Culto de Domingo', note: '' },
    { id: 'qua', weekday: 3, time: '20:00', title: 'Culto de Quarta', note: '' },
    { id: 'sex', weekday: 5, time: '20:00', title: 'Culto de Sexta', note: '' },
  ];
  // sexta, 9/10/2026, 12h em SP
  const list = nextCults(schedule, Date.parse('2026-10-09T15:00:00Z'));
  assert.deepEqual(
    list.slice(0, 3).map((c) => `${c.date} ${c.id}`),
    ['2026-10-09 sex', '2026-10-11 dom', '2026-10-14 qua'],
  );
  // culto que começou há 1 hora ainda aparece ("acontecendo agora")
  const during = nextCults(schedule, spToMs('2026-10-09', '21:00'));
  assert.equal(during[0].id, 'sex');
  assert.equal(during[0].date, '2026-10-09');
});

test('YouTube: reconhece os formatos de link', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=lkpfxNXXI3I'), 'lkpfxNXXI3I');
  assert.equal(youtubeId('https://youtu.be/lkpfxNXXI3I?si=abc'), 'lkpfxNXXI3I');
  assert.equal(youtubeId('https://youtube.com/live/lkpfxNXXI3I?feature=share'), 'lkpfxNXXI3I');
  assert.equal(youtubeId('https://m.youtube.com/shorts/lkpfxNXXI3I'), 'lkpfxNXXI3I');
  assert.equal(youtubeId('lkpfxNXXI3I'), 'lkpfxNXXI3I');
  assert.equal(youtubeId('https://vimeo.com/123'), null);
  assert.equal(youtubeId('não é link'), null);
});

test('base64url ida e volta', () => {
  const b = randomBytes(100);
  assert.deepEqual(Buffer.from(b64urlToBytes(bytesToB64url(b))), b);
});

// ---------------- Cenas que pregam ----------------
import { parseClock } from '../src/lib/clock';
import { readScene, CHAPTERS } from '../worker/routes/scenes';
import { BOOKS } from '../src/lib/bible';

test('cenas: lê o tempo do trecho', () => {
  assert.equal(parseClock(''), null);
  assert.equal(parseClock('83'), 83);
  assert.equal(parseClock('1:23'), 83);
  assert.equal(parseClock('01:02:03'), 3723);
  assert.equal(parseClock('1m23s'), 83);
  assert.ok(Number.isNaN(parseClock('1:75')));
  assert.ok(Number.isNaN(parseClock('abc')));
});

test('cenas: capítulos de cada livro batem com a Bíblia do app', () => {
  assert.equal(CHAPTERS.length, 66);
  BOOKS.forEach((b, i) => assert.equal(CHAPTERS[i], b.chapters, b.pt));
});

test('cenas: confere trecho e passagem', () => {
  const ok = readScene({
    youtube: 'https://youtu.be/dQw4w9WgXcQ?t=90',
    start_s: 90,
    end_s: 300,
    title: 'Jesus e a samaritana',
    passage: { book: 43, chapter: 4, verse: 1, verseEnd: 26 },
    questions: ['Pergunta 1', '', 'Pergunta 2'],
  });
  assert.equal(ok.youtube_id, 'dQw4w9WgXcQ');
  assert.equal(ok.bible_verse_end, 26);
  assert.deepEqual(JSON.parse(ok.questions), ['Pergunta 1', 'Pergunta 2']);
  const base = { youtube: 'dQw4w9WgXcQ', title: 'x', passage: { book: 43, chapter: 4 } };
  assert.throws(() => readScene({ ...base, start_s: 300, end_s: 100 }));
  assert.throws(() => readScene({ ...base, passage: { book: 43, chapter: 22 } }));
  assert.throws(() => readScene({ ...base, passage: {} }));
  assert.throws(() => readScene({ ...base, youtube: 'https://vimeo.com/123' }));
});

import { SCENES_CATALOG, catalogInserts } from '../worker/scenesCatalog';
test('cenas: catálogo oficial de The Chosen é válido', () => {
  assert.ok(SCENES_CATALOG.length >= 30);
  assert.equal(new Set(SCENES_CATALOG.map((s) => s.yt)).size, SCENES_CATALOG.length);
  for (const s of SCENES_CATALOG) {
    assert.match(s.yt, /^[A-Za-z0-9_-]{11}$/, s.title);
    const [book, chapter, v1, v2] = s.ref;
    assert.ok(book >= 1 && book <= 66 && chapter >= 1 && chapter <= CHAPTERS[book - 1], s.title);
    if (v2 !== undefined) assert.ok(v1 !== undefined && v2 > v1, s.title);
    assert.ok(s.questions.length >= 2, s.title);
  }
  assert.equal(catalogInserts().length, SCENES_CATALOG.length);
});
