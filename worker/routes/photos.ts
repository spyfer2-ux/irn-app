import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { auditLog, body, bool, dateStr, fail, int, isMedia, needMedia, needMember, now, originOf, rateLimit, reqStr, str } from '../util';
import { claimMedia, deleteMedia, useMediaStmt } from '../storage';
import { notifyNow } from '../push';

export const photoRoutes = new Hono<AppEnv>();

interface AlbumRow {
  id: number;
  title: string;
  description: string | null;
  event_date: string | null;
  cover_thumb_id: string | null;
  photo_count: number;
  members_can_upload: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

function refreshAlbum(env: Env, albumId: number | null) {
  if (!albumId) return null;
  return env.DB.prepare(
    `UPDATE albums SET
       photo_count = (SELECT COUNT(*) FROM photos WHERE album_id = ?1),
       cover_thumb_id = COALESCE(
         (SELECT thumb_id FROM photos WHERE album_id = ?1 AND thumb_id = albums.cover_thumb_id),
         (SELECT thumb_id FROM photos WHERE album_id = ?1 ORDER BY id DESC LIMIT 1)),
       updated_at = ?2
     WHERE id = ?1`,
  ).bind(albumId, now());
}

// ---------- álbuns ----------

photoRoutes.get('/albums', async (c) => {
  needMember(c);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM albums ORDER BY COALESCE(event_date, strftime('%Y-%m-%d', created_at / 1000, 'unixepoch')) DESC, id DESC`,
  ).all<AlbumRow>();
  const loose = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n, (SELECT thumb_id FROM photos WHERE album_id IS NULL ORDER BY id DESC LIMIT 1) AS thumb FROM photos WHERE album_id IS NULL',
  ).first<{ n: number; thumb: string | null }>();
  const total = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM photos').first<{ n: number }>();
  return c.json({ albums: results, loose: { count: loose?.n ?? 0, thumb: loose?.thumb ?? null }, total: total?.n ?? 0 });
});

photoRoutes.post('/albums', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const t = now();
  const row = await c.env.DB.prepare(
    'INSERT INTO albums (title, description, event_date, members_can_upload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(
      reqStr(b.title, 100, 'o nome do álbum'),
      str(b.description, 500, { label: 'descrição' }),
      dateStr(b.event_date, 'data do álbum'),
      b.members_can_upload === undefined ? 1 : bool(b.members_can_upload) ? 1 : 0,
      u.id,
      t,
      t,
    )
    .first<AlbumRow>();
  return c.json({ album: row });
});

photoRoutes.put('/albums/:id', async (c) => {
  needMedia(c);
  const id = int(c.req.param('id'), 1, 1e9)!;
  const b = await body(c);
  const r = await c.env.DB.prepare(
    'UPDATE albums SET title = ?, description = ?, event_date = ?, members_can_upload = ?, updated_at = ? WHERE id = ?',
  )
    .bind(
      reqStr(b.title, 100, 'o nome do álbum'),
      str(b.description, 500, { label: 'descrição' }),
      dateStr(b.event_date, 'data do álbum'),
      bool(b.members_can_upload) ? 1 : 0,
      now(),
      id,
    )
    .run();
  if (!r.meta.changes) fail(404, 'Álbum não encontrado.');
  return c.json({ ok: true });
});

photoRoutes.post('/albums/:id/cover', async (c) => {
  needMedia(c);
  const id = int(c.req.param('id'), 1, 1e9)!;
  const b = await body(c);
  const photo = await c.env.DB.prepare('SELECT thumb_id FROM photos WHERE id = ? AND album_id = ?')
    .bind(int(b.photo_id, 1, 1e12, 'foto'), id)
    .first<{ thumb_id: string }>();
  if (!photo) fail(404, 'Foto não encontrada neste álbum.');
  await c.env.DB.prepare('UPDATE albums SET cover_thumb_id = ? WHERE id = ?').bind(photo.thumb_id, id).run();
  return c.json({ ok: true });
});

photoRoutes.delete('/albums/:id', async (c) => {
  const u = needMedia(c);
  const id = int(c.req.param('id'), 1, 1e9)!;
  const album = await c.env.DB.prepare('SELECT title FROM albums WHERE id = ?').bind(id).first<{ title: string }>();
  if (!album) fail(404, 'Álbum não encontrado.');
  // As fotos não são apagadas: voltam para "Fotos avulsas".
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE photos SET album_id = NULL WHERE album_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM albums WHERE id = ?').bind(id),
    auditLog(c, u.id, 'album_excluido', album.title),
  ]);
  return c.json({ ok: true });
});

// ---------- fotos ----------

photoRoutes.get('/', async (c) => {
  needMember(c);
  const album = c.req.query('album') ?? 'todas';
  const before = int(c.req.query('antes'), 1, 1e12, 'cursor');
  const limit = int(c.req.query('limite'), 1, 120, 'limite') ?? 60;
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (album === 'avulsas') conds.push('p.album_id IS NULL');
  else if (album !== 'todas') {
    conds.push('p.album_id = ?');
    binds.push(int(album, 1, 1e9, 'álbum'));
  }
  if (before) {
    conds.push('p.id < ?');
    binds.push(before);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS uploader_name, a.title AS album_title FROM photos p
     LEFT JOIN users u ON u.id = p.uploaded_by LEFT JOIN albums a ON a.id = p.album_id
     ${where} ORDER BY p.id DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<{ id: number }>();
  const more = results.length > limit;
  return c.json({ photos: results.slice(0, limit), next: more ? results[limit - 1].id : null });
});

photoRoutes.post('/', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `foto:${u.id}`, 400, 3600_000);
  const b = await body(c);
  const albumId = int(b.album_id, 1, 1e9, 'álbum');
  if (albumId) {
    const album = await c.env.DB.prepare('SELECT members_can_upload FROM albums WHERE id = ?').bind(albumId).first<AlbumRow>();
    if (!album) fail(404, 'Álbum não encontrado.');
    if (!album.members_can_upload && !isMedia(u)) fail(403, 'Neste álbum só a equipe de mídia pode enviar fotos.');
  }
  const media = await claimMedia(c.env, b.media_id, u, ['photo']);
  const thumb = await claimMedia(c.env, b.thumb_id, u, ['thumb']);
  const taken = await c.env.DB.prepare('SELECT 1 FROM photos WHERE media_id = ?').bind(media.id).first();
  if (taken) fail(409, 'Esta foto já foi publicada.');
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(
      'INSERT INTO photos (album_id, media_id, thumb_id, caption, width, height, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      albumId,
      media.id,
      thumb.id,
      str(b.caption, 300, { label: 'legenda' }),
      media.width ?? int(b.width, 1, 20000),
      media.height ?? int(b.height, 1, 20000),
      u.id,
      now(),
    ),
    useMediaStmt(c.env, [media.id, thumb.id])!,
  ];
  const ref = refreshAlbum(c.env, albumId);
  if (ref) stmts.push(ref);
  const res = await c.env.DB.batch(stmts);
  return c.json({ ok: true, id: res[0].meta.last_row_id });
});

/** Depois de um envio em lote, o app avisa uma única vez: "Novas fotos no álbum ...". */
photoRoutes.post('/anunciar', async (c) => {
  const u = needMember(c);
  const b = await body(c);
  const count = int(b.count, 1, 10000, 'quantidade') ?? 1;
  const albumId = int(b.album_id, 1, 1e9, 'álbum');
  const marker = `anuncio-fotos:${albumId ?? 'avulsas'}:${Math.floor(now() / 3600_000)}`;
  const first = await c.env.DB.prepare('INSERT INTO marks (key, created_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .bind(marker, now())
    .run();
  if (!first.meta.changes) return c.json({ ok: true, skipped: true });
  const album = albumId
    ? await c.env.DB.prepare('SELECT title FROM albums WHERE id = ?').bind(albumId).first<{ title: string }>()
    : null;
  await notifyNow(c.env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
    topic: 'fotos',
    audience: 'members',
    title: album ? `Novas fotos: ${album.title}` : 'Novas fotos na biblioteca',
    body: `${u.name.split(' ')[0]} enviou ${count} foto${count > 1 ? 's' : ''}.`,
    url: albumId ? `/fotos/album/${albumId}` : '/fotos',
    createdBy: u.id,
  });
  return c.json({ ok: true });
});

photoRoutes.patch('/:id', async (c) => {
  const u = needMember(c);
  const id = int(c.req.param('id'), 1, 1e12)!;
  const p = await c.env.DB.prepare('SELECT * FROM photos WHERE id = ?').bind(id).first<{ uploaded_by: number; album_id: number | null }>();
  if (!p) fail(404, 'Foto não encontrada.');
  if (p.uploaded_by !== u.id && !isMedia(u)) fail(403, 'Só quem enviou (ou a equipe de mídia) pode alterar esta foto.');
  const b = await body(c);
  const newAlbum = b.album_id === undefined ? p.album_id : int(b.album_id, 1, 1e9, 'álbum');
  if (newAlbum && newAlbum !== p.album_id) {
    const exists = await c.env.DB.prepare('SELECT 1 FROM albums WHERE id = ?').bind(newAlbum).first();
    if (!exists) fail(404, 'Álbum não encontrado.');
  }
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare('UPDATE photos SET caption = ?, album_id = ? WHERE id = ?').bind(
      str(b.caption, 300, { label: 'legenda' }),
      newAlbum,
      id,
    ),
  ];
  for (const a of new Set([p.album_id, newAlbum])) {
    const r = refreshAlbum(c.env, a);
    if (r) stmts.push(r);
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

photoRoutes.delete('/:id', async (c) => {
  const u = needMember(c);
  const id = int(c.req.param('id'), 1, 1e12)!;
  const p = await c.env.DB.prepare('SELECT * FROM photos WHERE id = ?')
    .bind(id)
    .first<{ uploaded_by: number; album_id: number | null; media_id: string; thumb_id: string }>();
  if (!p) fail(404, 'Foto não encontrada.');
  if (p.uploaded_by !== u.id && !isMedia(u)) fail(403, 'Só quem enviou (ou a equipe de mídia) pode apagar esta foto.');
  const stmts: D1PreparedStatement[] = [c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id)];
  const r = refreshAlbum(c.env, p.album_id);
  if (r) stmts.push(r);
  if (p.uploaded_by !== u.id) stmts.push(auditLog(c, u.id, 'foto_removida', `foto ${id} de outro membro`));
  await c.env.DB.batch(stmts);
  await deleteMedia(c.env, [p.media_id, p.thumb_id]);
  return c.json({ ok: true });
});
