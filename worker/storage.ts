/**
 * Arquivos do app (fotos, miniaturas, vídeos, comprovantes, capas e logo).
 * - Com R2 ativado (binding BUCKET): tudo vai para o R2 (10 GB grátis) e o envio de vídeos fica disponível.
 * - Sem R2: as imagens ficam no próprio banco D1 (em pedaços) e o envio de vídeos fica desligado.
 */
import { Hono } from 'hono';
import type { AppEnv, Ctx, Env, User } from './types';
import { b64ToBytes, bytesToB64, fail, int, isAdmin, isMedia, isMember, needMedia, needMember, now, oneOf, randomToken, rateLimit } from './util';

export const D1_CHUNK = 512 * 1024;
export const MAX_IMAGE_R2 = 6 * 1024 * 1024;
export const MAX_IMAGE_D1 = 2 * 1024 * 1024;
export const MAX_VIDEO = 600 * 1024 * 1024;
export const VIDEO_PART = 8 * 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
const AUDIO_MIMES = ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/webm'];
const IMAGE_KINDS = ['photo', 'thumb', 'receipt', 'cover', 'poster', 'logo', 'icon'] as const;
type ImageKind = (typeof IMAGE_KINDS)[number];

export interface MediaRow {
  id: string;
  kind: string;
  mime: string;
  size: number;
  storage: 'r2' | 'd1';
  owner_id: number | null;
  access: 'public' | 'members' | 'private';
  status: 'uploading' | 'ready';
  used: number;
  upload_id: string | null;
  parts: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  created_at: number;
}

export function storageMode(env: Env): 'r2' | 'd1' {
  return env.BUCKET ? 'r2' : 'd1';
}

const key = (id: string) => `m/${id}`;

function toB64(bytes: Uint8Array): string {
  const native = (bytes as unknown as { toBase64?: () => string }).toBase64;
  return typeof native === 'function' ? native.call(bytes) : bytesToB64(bytes);
}
function fromB64(s: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  return typeof native === 'function' ? native(s) : b64ToBytes(s);
}

export async function getMedia(env: Env, id: string): Promise<MediaRow | null> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(id)) return null;
  return env.DB.prepare('SELECT * FROM media WHERE id = ?').bind(id).first<MediaRow>();
}

export function canRead(m: MediaRow, u: User | null): boolean {
  if (m.access === 'public') return true;
  if (m.access === 'members') return isMember(u);
  return !!u && (u.id === m.owner_id || isAdmin(u));
}

/** Confere se um arquivo recém-enviado pode ser usado por esta pessoa (é dela e é do tipo certo). */
export async function claimMedia(env: Env, id: unknown, user: User, kinds: string[]): Promise<MediaRow> {
  if (typeof id !== 'string') fail(400, 'Arquivo não informado.');
  const m = await getMedia(env, id);
  if (!m || m.status !== 'ready' || !kinds.includes(m.kind)) fail(400, 'Arquivo inválido ou ainda não terminou de enviar.');
  if (m.owner_id !== user.id && !isAdmin(user)) fail(403, 'Este arquivo é de outra pessoa.');
  return m;
}

export async function optionalMedia(env: Env, id: unknown, user: User, kinds: string[]): Promise<string | null> {
  if (id === null || id === undefined || id === '') return null;
  const m = await claimMedia(env, id, user, kinds);
  return m.id;
}

/** Apaga arquivos (do R2 ou do D1). */
export async function deleteMedia(env: Env, ids: (string | null | undefined)[]): Promise<void> {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return;
  const { results } = await env.DB.prepare(`SELECT * FROM media WHERE id IN (${list.map(() => '?').join(',')})`)
    .bind(...list)
    .all<MediaRow>();
  for (const m of results) {
    if (m.storage === 'r2' && env.BUCKET) {
      try {
        if (m.status === 'uploading' && m.upload_id) await env.BUCKET.resumeMultipartUpload(key(m.id), m.upload_id).abort();
        else await env.BUCKET.delete(key(m.id));
      } catch (e) {
        console.warn('erro ao apagar do R2', m.id, String(e));
      }
    }
  }
  const stmts: D1PreparedStatement[] = [];
  for (const id of list) {
    stmts.push(env.DB.prepare('DELETE FROM media_blobs WHERE media_id = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM media_parts WHERE media_id = ?').bind(id));
    stmts.push(env.DB.prepare('DELETE FROM media WHERE id = ?').bind(id));
  }
  await env.DB.batch(stmts);
}

/** Quem pode enviar cada tipo de imagem, e com qual acesso. */
function imagePolicy(kind: ImageKind, u: User, requested: string | undefined): 'public' | 'members' | 'private' {
  switch (kind) {
    case 'photo':
    case 'thumb':
      if (!isMember(u)) fail(403, 'Seu cadastro precisa ser aprovado para enviar fotos.');
      return 'members';
    case 'receipt':
      if (!isMember(u)) fail(403, 'Seu cadastro precisa ser aprovado.');
      return 'private';
    case 'cover':
    case 'poster':
      if (!isMedia(u) && !(kind === 'cover' && isMember(u) && requested === 'members'))
        fail(403, 'Só a equipe de mídia e a liderança podem enviar este tipo de imagem.');
      return requested === 'members' ? 'members' : 'public';
    case 'logo':
    case 'icon':
      if (!isAdmin(u)) fail(403, 'Só administradores podem trocar a logo.');
      return 'public';
  }
}

export const mediaRoutes = new Hono<AppEnv>();

/** Envio de imagem (corpo = bytes da imagem já reduzida pelo app). */
mediaRoutes.post('/', async (c) => {
  const u = needMember(c);
  const kind = oneOf(c.req.query('kind'), IMAGE_KINDS, 'tipo de arquivo');
  const access = imagePolicy(kind, u, c.req.query('access'));
  const mime = (c.req.header('content-type') ?? '').split(';')[0].trim();
  if (!IMAGE_MIMES.includes(mime)) fail(415, 'Envie imagens JPG, PNG ou WEBP.');
  await rateLimit(c.env, `up:${u.id}`, 800, 3600_000);
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const mode = storageMode(c.env);
  const max = mode === 'r2' ? MAX_IMAGE_R2 : MAX_IMAGE_D1;
  if (!bytes.length) fail(400, 'Arquivo vazio.');
  if (bytes.length > max) fail(413, `Imagem muito grande (máximo ${Math.round(max / 1024 / 1024)} MB).`);
  const id = randomToken(18);
  const width = int(c.req.query('w'), 1, 20000, 'largura');
  const height = int(c.req.query('h'), 1, 20000, 'altura');
  const stmts: D1PreparedStatement[] = [];
  let parts = 1;
  if (mode === 'r2') {
    await c.env.BUCKET!.put(key(id), bytes, { httpMetadata: { contentType: mime } });
  } else {
    parts = Math.ceil(bytes.length / D1_CHUNK);
    for (let p = 0; p < parts; p++) {
      const chunk = bytes.subarray(p * D1_CHUNK, Math.min(bytes.length, (p + 1) * D1_CHUNK));
      stmts.push(c.env.DB.prepare('INSERT INTO media_blobs (media_id, part, data) VALUES (?, ?, ?)').bind(id, p, toB64(chunk)));
    }
  }
  stmts.push(
    c.env.DB.prepare(
      `INSERT INTO media (id, kind, mime, size, storage, owner_id, access, status, parts, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?)`,
    ).bind(id, kind, mime, bytes.length, mode, u.id, access, parts, width, height, now()),
  );
  await c.env.DB.batch(stmts);
  return c.json({ id, size: bytes.length });
});

// ---------- vídeos (envio em partes, só com R2) ----------

mediaRoutes.post('/video/start', async (c) => {
  const u = needMedia(c);
  if (!c.env.BUCKET) fail(400, 'Para enviar vídeos e áudios pelo app, ative o armazenamento R2 (veja Administração → Configurações).');
  const b = (await c.req.json().catch(() => ({}))) as { mime?: string; size?: number; access?: string; kind?: string };
  const kind = b.kind === 'audio' ? 'audio' : 'video';
  const mime = kind === 'audio' ? oneOf(b.mime, AUDIO_MIMES, 'formato do áudio') : oneOf(b.mime, VIDEO_MIMES, 'formato do vídeo');
  const size = int(b.size, 1, MAX_VIDEO, 'tamanho');
  if (!size) fail(400, 'Tamanho do arquivo não informado.');
  const access = b.access === 'public' ? 'public' : 'members';
  await rateLimit(c.env, `vid:${u.id}`, 30, 3600_000);
  const id = randomToken(18);
  const mpu = await c.env.BUCKET.createMultipartUpload(key(id), { httpMetadata: { contentType: mime } });
  await c.env.DB.prepare(
    `INSERT INTO media (id, kind, mime, size, storage, owner_id, access, status, upload_id, created_at)
     VALUES (?, ?, ?, ?, 'r2', ?, ?, 'uploading', ?, ?)`,
  )
    .bind(id, kind, mime, size, u.id, access, mpu.uploadId, now())
    .run();
  return c.json({ id, partSize: VIDEO_PART, parts: Math.ceil(size / VIDEO_PART) });
});

async function ownUpload(c: Ctx, id: string): Promise<MediaRow> {
  const u = needMedia(c);
  const m = await getMedia(c.env, id);
  if (!m || (m.kind !== 'video' && m.kind !== 'audio') || m.status !== 'uploading' || !m.upload_id) fail(404, 'Envio não encontrado.');
  if (m.owner_id !== u.id && !isAdmin(u)) fail(403, 'Este envio é de outra pessoa.');
  if (!c.env.BUCKET) fail(400, 'Armazenamento R2 não está ativo.');
  return m;
}

mediaRoutes.put('/video/:id/part/:n', async (c) => {
  const m = await ownUpload(c, c.req.param('id'));
  const n = int(c.req.param('n'), 1, 10000, 'parte')!;
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (!bytes.length || bytes.length > VIDEO_PART + 1024) fail(400, 'Parte do vídeo com tamanho inválido.');
  const mpu = c.env.BUCKET!.resumeMultipartUpload(key(m.id), m.upload_id!);
  const part = await mpu.uploadPart(n, bytes);
  await c.env.DB.prepare('INSERT OR REPLACE INTO media_parts (media_id, part, etag) VALUES (?, ?, ?)')
    .bind(m.id, n, part.etag)
    .run();
  return c.json({ ok: true, part: n });
});

mediaRoutes.post('/video/:id/complete', async (c) => {
  const m = await ownUpload(c, c.req.param('id'));
  const b = (await c.req.json().catch(() => ({}))) as { duration?: number; width?: number; height?: number };
  const { results: parts } = await c.env.DB.prepare('SELECT part, etag FROM media_parts WHERE media_id = ? ORDER BY part')
    .bind(m.id)
    .all<{ part: number; etag: string }>();
  if (!parts.length) fail(400, 'Nenhuma parte do vídeo foi recebida.');
  const mpu = c.env.BUCKET!.resumeMultipartUpload(key(m.id), m.upload_id!);
  const obj = await mpu.complete(parts.map((p) => ({ partNumber: p.part, etag: p.etag })));
  const duration = typeof b.duration === 'number' && isFinite(b.duration) ? Math.min(b.duration, 86400) : null;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE media SET status = 'ready', upload_id = NULL, size = ?, parts = ?, duration = ?, width = ?, height = ? WHERE id = ?",
    ).bind(
      obj.size,
      parts.length,
      duration,
      int(b.width, 1, 20000) ?? null,
      int(b.height, 1, 20000) ?? null,
      m.id,
    ),
    c.env.DB.prepare('DELETE FROM media_parts WHERE media_id = ?').bind(m.id),
  ]);
  return c.json({ id: m.id, size: obj.size });
});

mediaRoutes.delete('/video/:id', async (c) => {
  const m = await ownUpload(c, c.req.param('id'));
  await deleteMedia(c.env, [m.id]);
  return c.json({ ok: true });
});

// ---------- leitura ----------

export async function serveMedia(c: Ctx, m: MediaRow, opts: { download?: boolean; cache?: string } = {}): Promise<Response> {
  const headers = new Headers();
  headers.set('content-type', m.mime);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', opts.cache ?? (m.access === 'public' ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable'));
  if (opts.download) {
    const ext = m.mime.split('/')[1]?.replace('quicktime', 'mov').replace('jpeg', 'jpg').replace('mpeg', 'mp3').replace('x-m4a', 'm4a') ?? 'bin';
    headers.set('content-disposition', `attachment; filename="irn-${m.kind}-${m.id.slice(0, 8)}.${ext}"`);
  }
  if (m.storage === 'r2') {
    if (!c.env.BUCKET) return c.json({ error: 'Armazenamento R2 desligado.' }, 503);
    const range = c.req.header('range');
    const obj = await c.env.BUCKET.get(key(m.id), range ? { range: c.req.raw.headers } : undefined);
    if (!obj) return c.json({ error: 'Arquivo não encontrado.' }, 404);
    headers.set('accept-ranges', 'bytes');
    headers.set('etag', obj.httpEtag);
    if (range && obj.range) {
      const r = obj.range as { offset?: number; length?: number; suffix?: number };
      let start: number;
      let len: number;
      if (typeof r.suffix === 'number') {
        len = Math.min(r.suffix, obj.size);
        start = obj.size - len;
      } else {
        start = r.offset ?? 0;
        len = r.length ?? obj.size - start;
      }
      headers.set('content-range', `bytes ${start}-${start + len - 1}/${obj.size}`);
      headers.set('content-length', String(len));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set('content-length', String(obj.size));
    return new Response(obj.body, { status: 200, headers });
  }
  const { results } = await c.env.DB.prepare('SELECT data FROM media_blobs WHERE media_id = ? ORDER BY part')
    .bind(m.id)
    .all<{ data: string }>();
  if (!results.length) return c.json({ error: 'Arquivo não encontrado.' }, 404);
  const chunks = results.map((r) => fromB64(r.data));
  const total = chunks.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const ch of chunks) {
    out.set(ch, o);
    o += ch.length;
  }
  headers.set('content-length', String(total));
  return new Response(out, { status: 200, headers });
}

mediaRoutes.get('/:id', async (c) => {
  const m = await getMedia(c.env, c.req.param('id'));
  if (!m || m.status !== 'ready') return c.json({ error: 'Arquivo não encontrado.' }, 404);
  if (!canRead(m, c.get('user'))) return c.json({ error: 'Você não tem acesso a este arquivo.' }, c.get('user') ? 403 : 401);
  return serveMedia(c, m, { download: c.req.query('baixar') === '1' });
});

/** Marca arquivos como "em uso" (ligados a uma foto, vídeo, evento...). Os que nunca forem usados são apagados depois. */
export function useMediaStmt(env: Env, ids: (string | null | undefined)[]): D1PreparedStatement | null {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return null;
  return env.DB.prepare(`UPDATE media SET used = 1 WHERE id IN (${list.map(() => '?').join(',')})`).bind(...list);
}

/** Limpeza diária: envios que nunca terminaram e arquivos enviados que nunca foram usados. */
export async function cleanupMedia(env: Env): Promise<number> {
  const limit = now() - 24 * 3600_000;
  const { results } = await env.DB.prepare(
    "SELECT id FROM media WHERE ((status = 'uploading') OR (used = 0 AND kind NOT IN ('logo','icon'))) AND created_at < ? LIMIT 30",
  )
    .bind(limit)
    .all<{ id: string }>();
  await deleteMedia(env, results.map((r) => r.id));
  return results.length;
}
