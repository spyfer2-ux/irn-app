import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { auditLog, body, bool, fail, int, isMedia, isMember, needMedia, now, oneOf, reqStr, str, visibleSet } from '../util';
import { claimMedia, deleteMedia, optionalMedia, useMediaStmt } from '../storage';
import { getSetting, setSetting } from '../settings';

export const videoRoutes = new Hono<AppEnv>();

export const DEFAULT_CATEGORY = 'Cultos e pregações';

export function youtubeId(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const ok = (v: string | null | undefined) => (v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null);
  if (host === 'youtu.be') return ok(u.pathname.slice(1).split('/')[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = ok(u.searchParams.get('v'));
    if (v) return v;
    const m = u.pathname.match(/^\/(?:live|shorts|embed|v)\/([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
  }
  return null;
}

export async function oembed(id: string): Promise<{ title?: string; author_name?: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as { title?: string; author_name?: string };
  } catch {
    return null;
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Busca os vídeos mais recentes do canal do YouTube (pelo feed público) e acrescenta os novos. */
export async function syncYoutube(env: Env): Promise<{ added: number; error?: string }> {
  const church = await getSetting(env, 'church');
  const yt = await getSetting(env, 'youtube');
  const channel = church.youtube_channel_id;
  const save = (result: string) => setSetting(env, 'youtube', { ...yt, last_sync: now(), last_result: result }, null);
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channel)) {
    await save('Canal do YouTube não configurado.');
    return { added: 0, error: 'Canal do YouTube não configurado.' };
  }
  let xml = '';
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (app IRN)' },
    });
    if (!res.ok) throw new Error(`YouTube respondeu ${res.status}`);
    xml = await res.text();
  } catch (e) {
    await save(`Falhou: ${String(e).slice(0, 120)}`);
    return { added: 0, error: 'Não consegui acessar o YouTube agora.' };
  }
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const stmts: D1PreparedStatement[] = [];
  for (const e of entries.slice(0, 30)) {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const title = decodeXml(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim().slice(0, 200) || 'Vídeo';
    const desc = decodeXml(e.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '').trim().slice(0, 2000);
    const published = Date.parse(e.match(/<published>([^<]+)<\/published>/)?.[1] ?? '') || now();
    stmts.push(
      env.DB.prepare(
        `INSERT INTO videos (source, youtube_id, title, description, category, visibility, auto, published_at, created_at)
         VALUES ('youtube', ?, ?, ?, ?, 'public', 1, ?, ?) ON CONFLICT(youtube_id) DO NOTHING`,
      ).bind(id, title, desc || null, DEFAULT_CATEGORY, published, now()),
    );
  }
  let added = 0;
  if (stmts.length) {
    const res = await env.DB.batch(stmts);
    added = res.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  }
  await save(`OK: ${entries.length} vídeos no feed, ${added} novos.`);
  return { added };
}

videoRoutes.get('/', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const conds = [`v.visibility IN (${vis.map(() => '?').join(',')})`];
  const binds: unknown[] = [...vis];
  if (!(isMedia(u) && c.req.query('ocultos') === '1')) conds.push('v.hidden = 0');
  const fonte = c.req.query('fonte');
  if (fonte === 'youtube' || fonte === 'upload') {
    conds.push('v.source = ?');
    binds.push(fonte);
  }
  const cat = c.req.query('categoria');
  if (cat) {
    conds.push('v.category = ?');
    binds.push(cat.slice(0, 60));
  }
  const q = c.req.query('q');
  if (q) {
    conds.push('(v.title LIKE ? OR v.speaker LIKE ?)');
    binds.push(`%${q.slice(0, 60)}%`, `%${q.slice(0, 60)}%`);
  }
  const before = int(c.req.query('antes'), 0, 1e15, 'cursor');
  if (before) {
    conds.push('v.published_at < ?');
    binds.push(before);
  }
  const limit = int(c.req.query('limite'), 1, 60, 'limite') ?? 24;
  const { results } = await c.env.DB.prepare(
    `SELECT v.*, m.access AS media_access FROM videos v LEFT JOIN media m ON m.id = v.media_id
     WHERE ${conds.join(' AND ')} ORDER BY v.published_at DESC LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<{ published_at: number }>();
  const more = results.length > limit;
  const cats = await c.env.DB.prepare(
    `SELECT category, COUNT(*) AS n FROM videos WHERE hidden = 0 AND category IS NOT NULL AND visibility IN (${vis
      .map(() => '?')
      .join(',')}) GROUP BY category ORDER BY n DESC`,
  )
    .bind(...vis)
    .all<{ category: string; n: number }>();
  return c.json({
    videos: results.slice(0, limit),
    next: more ? results[limit - 1].published_at : null,
    categories: cats.results,
  });
});

videoRoutes.get('/:id{[0-9]+}', async (c) => {
  const u = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM videos WHERE id = ?')
    .bind(Number(c.req.param('id')))
    .first<{ visibility: string; hidden: number }>();
  if (!v || (v.hidden && !isMedia(u))) fail(404, 'Vídeo não encontrado.');
  if (v.visibility === 'members' && !isMember(u)) fail(isMember(u) ? 403 : 401, 'Este vídeo é só para membros.');
  return c.json({ video: v });
});

videoRoutes.post('/youtube', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const id = youtubeId(reqStr(b.url, 300, 'o link do YouTube'));
  if (!id) fail(400, 'Não reconheci este link do YouTube. Copie o link pelo botão "Compartilhar" do vídeo.');
  const exists = await c.env.DB.prepare('SELECT id FROM videos WHERE youtube_id = ?').bind(id).first<{ id: number }>();
  if (exists) fail(409, 'Este vídeo já está no app.');
  let title = str(b.title, 200, { label: 'título' });
  if (!title) {
    const info = await oembed(id);
    title = info?.title?.slice(0, 200) ?? null;
  }
  if (!title) fail(400, 'Não consegui ler o título do vídeo. Digite um título.');
  const row = await c.env.DB.prepare(
    `INSERT INTO videos (source, youtube_id, title, description, category, speaker, visibility, published_at, created_by, created_at)
     VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      id,
      title,
      str(b.description, 2000, { label: 'descrição' }),
      str(b.category, 60, { label: 'categoria' }) ?? DEFAULT_CATEGORY,
      str(b.speaker, 80, { label: 'pregador' }),
      b.visibility === 'members' ? 'members' : 'public',
      now(),
      u.id,
      now(),
    )
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

videoRoutes.post('/upload', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const media = await claimMedia(c.env, b.media_id, u, ['video']);
  const poster = await optionalMedia(c.env, b.poster_id, u, ['poster']);
  const visibility = oneOf(b.visibility ?? 'members', ['public', 'members'] as const, 'visibilidade');
  // O arquivo segue a mesma visibilidade do vídeo.
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO videos (source, media_id, poster_id, title, description, category, speaker, duration, visibility, published_at, created_by, created_at)
       VALUES ('upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      media.id,
      poster,
      reqStr(b.title, 200, 'o título'),
      str(b.description, 2000, { label: 'descrição' }),
      str(b.category, 60, { label: 'categoria' }) ?? 'Vídeos curtos',
      str(b.speaker, 80, { label: 'pregador' }),
      media.duration,
      visibility,
      now(),
      u.id,
      now(),
    ),
    c.env.DB.prepare('UPDATE media SET access = ? WHERE id IN (?, ?)').bind(visibility, media.id, poster ?? ''),
    useMediaStmt(c.env, [media.id, poster])!,
  ]);
  return c.json({ id: res[0].meta.last_row_id });
});

videoRoutes.put('/:id{[0-9]+}', async (c) => {
  needMedia(c);
  const id = Number(c.req.param('id'));
  const v = await c.env.DB.prepare('SELECT media_id, poster_id FROM videos WHERE id = ?')
    .bind(id)
    .first<{ media_id: string | null; poster_id: string | null }>();
  if (!v) fail(404, 'Vídeo não encontrado.');
  const b = await body(c);
  const visibility = oneOf(b.visibility ?? 'public', ['public', 'members'] as const, 'visibilidade');
  const stmts = [
    c.env.DB.prepare(
      'UPDATE videos SET title = ?, description = ?, category = ?, speaker = ?, visibility = ?, hidden = ? WHERE id = ?',
    ).bind(
      reqStr(b.title, 200, 'o título'),
      str(b.description, 2000, { label: 'descrição' }),
      str(b.category, 60, { label: 'categoria' }),
      str(b.speaker, 80, { label: 'pregador' }),
      visibility,
      bool(b.hidden) ? 1 : 0,
      id,
    ),
  ];
  if (v.media_id)
    stmts.push(c.env.DB.prepare('UPDATE media SET access = ? WHERE id IN (?, ?)').bind(visibility, v.media_id, v.poster_id ?? ''));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

videoRoutes.delete('/:id{[0-9]+}', async (c) => {
  const u = needMedia(c);
  const id = Number(c.req.param('id'));
  const v = await c.env.DB.prepare('SELECT title, media_id, poster_id FROM videos WHERE id = ?')
    .bind(id)
    .first<{ title: string; media_id: string | null; poster_id: string | null }>();
  if (!v) fail(404, 'Vídeo não encontrado.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id),
    auditLog(c, u.id, 'video_excluido', v.title),
  ]);
  await deleteMedia(c.env, [v.media_id, v.poster_id]);
  return c.json({ ok: true });
});

videoRoutes.post('/sincronizar', async (c) => {
  needMedia(c);
  const r = await syncYoutube(c.env);
  if (r.error) fail(502, r.error);
  return c.json(r);
});
