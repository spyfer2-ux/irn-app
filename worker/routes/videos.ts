import { Hono } from 'hono';
import type { AppEnv, Ctx, Env } from '../types';
import { auditLog, body, bool, driveFileId, fail, int, isMedia, isMember, needMedia, now, oneOf, originOf, reqStr, str, visibleSet } from '../util';
import { drain, notify, notifyNow } from '../push';
import { claimMedia, deleteMedia, optionalMedia, useMediaStmt } from '../storage';
import { getSetting, setSetting } from '../settings';

export const videoRoutes = new Hono<AppEnv>();

export const DEFAULT_CATEGORY = 'Cultos e pregações';

const wait = (c: Ctx) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

/**
 * Confere se o arquivo do Drive está aberto para quem tem o link. Não trava o cadastro:
 * devolve null quando o Google não deixa claro, para nunca barrar um vídeo bom.
 */
async function driveAberto(id: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://drive.google.com/file/d/${id}/view`, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (app IRN)' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 200) return true;
    if (res.status === 403 || res.status === 404) return false;
    if ((res.headers.get('location') ?? '').includes('accounts.google.com')) return false;
    return null;
  } catch {
    return null;
  }
}

/** Marca a capa como usada e deixa ela visível para o mesmo público do vídeo. */
async function guardaCapa(c: Ctx, capa: string | null, visibility: string) {
  if (!capa) return;
  await c.env.DB.batch([
    useMediaStmt(c.env, [capa])!,
    c.env.DB.prepare('UPDATE media SET access = ? WHERE id = ?').bind(visibility, capa),
  ]);
}

/** Avisa a igreja que entrou vídeo novo (vale para link do YouTube, link do Drive e envio pelo app). */
function avisarVideoNovo(c: Ctx, id: number, title: string, visibility: string, userId: number) {
  return notifyNow(c.env, originOf(c), wait(c), {
    topic: 'avisos',
    audience: visibility === 'members' ? 'members' : 'all',
    title: 'Vídeo novo no app',
    body: title,
    url: `/videos/${id}`,
    createdBy: userId,
  });
}

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

export function decodeXml(s: string): string {
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
  const titulos: string[] = [];
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
    titulos.push(title);
  }
  let added = 0;
  const novos: { id: number; title: string }[] = [];
  if (stmts.length) {
    const res = await env.DB.batch(stmts);
    res.forEach((r, i) => {
      if (r.meta.changes) novos.push({ id: Number(r.meta.last_row_id), title: titulos[i] });
    });
    added = novos.length;
  }
  if (novos.length) {
    await notify(env, {
      topic: 'avisos',
      audience: 'all',
      title: novos.length === 1 ? 'Vídeo novo no app' : `${novos.length} vídeos novos no app`,
      body: novos.length === 1 ? novos[0].title : `${novos[0].title} e mais ${novos.length - 1}`,
      url: novos.length === 1 ? `/videos/${novos[0].id}` : '/videos',
    });
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
  if (fonte === 'youtube' || fonte === 'upload' || fonte === 'drive') {
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
  const link = reqStr(b.url, 300, 'o link do YouTube');
  const id = youtubeId(link);
  if (!id) fail(400, 'Não reconheci este link do YouTube. Copie o link pelo botão "Compartilhar" do vídeo.');
  // Link de Short já é vídeo em pé; fora isso, vale o que a equipe marcou.
  const emPe = /\/shorts\//.test(link) || bool(b.vertical) ? 1 : 0;
  const exists = await c.env.DB.prepare('SELECT id FROM videos WHERE youtube_id = ?').bind(id).first<{ id: number }>();
  if (exists) fail(409, 'Este vídeo já está no app.');
  let title = str(b.title, 200, { label: 'título' });
  if (!title) {
    const info = await oembed(id);
    title = info?.title?.slice(0, 200) ?? null;
  }
  if (!title) fail(400, 'Não consegui ler o título do vídeo. Digite um título.');
  const vis = b.visibility === 'members' ? 'members' : 'public';
  const capa = await optionalMedia(c.env, b.poster_id, u, ['cover', 'poster']);
  const row = await c.env.DB.prepare(
    `INSERT INTO videos (source, youtube_id, poster_id, title, description, category, speaker, visibility, vertical, published_at, created_by, created_at)
     VALUES ('youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      id,
      capa,
      title,
      str(b.description, 2000, { label: 'descrição' }),
      str(b.category, 60, { label: 'categoria' }) ?? DEFAULT_CATEGORY,
      str(b.speaker, 80, { label: 'pregador' }),
      vis,
      emPe,
      now(),
      u.id,
      now(),
    )
    .first<{ id: number }>();
  await guardaCapa(c, capa, vis);
  await avisarVideoNovo(c, row!.id, title, vis, u.id);
  return c.json({ id: row!.id });
});

videoRoutes.post('/drive', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const id = driveFileId(reqStr(b.url, 400, 'o link do Google Drive'));
  if (!id) fail(400, 'Não reconheci este link do Google Drive. No Drive: abra o vídeo → Compartilhar → Copiar link.');
  const exists = await c.env.DB.prepare('SELECT id FROM videos WHERE drive_id = ?').bind(id).first<{ id: number }>();
  if (exists) fail(409, 'Este vídeo do Drive já está no app.');
  const titulo = reqStr(b.title, 200, 'o título');
  const vis = b.visibility === 'members' ? 'members' : 'public';
  const capa = await optionalMedia(c.env, b.poster_id, u, ['cover', 'poster']);
  const row = await c.env.DB.prepare(
    `INSERT INTO videos (source, drive_id, poster_id, title, description, category, speaker, visibility, vertical, published_at, created_by, created_at)
     VALUES ('drive', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      id,
      capa,
      titulo,
      str(b.description, 2000, { label: 'descrição' }),
      str(b.category, 60, { label: 'categoria' }) ?? DEFAULT_CATEGORY,
      str(b.speaker, 80, { label: 'pregador' }),
      vis,
      bool(b.vertical) ? 1 : 0,
      now(),
      u.id,
      now(),
    )
    .first<{ id: number }>();
  await guardaCapa(c, capa, vis);
  await avisarVideoNovo(c, row!.id, titulo, vis, u.id);
  const aberto = await driveAberto(id);
  return c.json({
    id: row!.id,
    aviso:
      aberto === false
        ? 'O vídeo foi adicionado, mas o arquivo parece estar privado no Drive: abra o vídeo no Google Drive → Compartilhar → Acesso geral → "Qualquer pessoa com o link", senão ele não toca no app.'
        : null,
  });
});

videoRoutes.post('/upload', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const media = await claimMedia(c.env, b.media_id, u, ['video']);
  const poster = await optionalMedia(c.env, b.poster_id, u, ['poster']);
  const visibility = oneOf(b.visibility ?? 'members', ['public', 'members'] as const, 'visibilidade');
  const titulo = reqStr(b.title, 200, 'o título');
  // O arquivo segue a mesma visibilidade do vídeo.
  const res = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO videos (source, media_id, poster_id, title, description, category, speaker, duration, visibility, published_at, created_by, created_at)
       VALUES ('upload', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      media.id,
      poster,
      titulo,
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
  const novoId = Number(res[0].meta.last_row_id);
  await avisarVideoNovo(c, novoId, titulo, visibility, u.id);
  return c.json({ id: novoId });
});

videoRoutes.put('/:id{[0-9]+}', async (c) => {
  const u = needMedia(c);
  const id = Number(c.req.param('id'));
  const v = await c.env.DB.prepare('SELECT media_id, poster_id FROM videos WHERE id = ?')
    .bind(id)
    .first<{ media_id: string | null; poster_id: string | null }>();
  if (!v) fail(404, 'Vídeo não encontrado.');
  const b = await body(c);
  const visibility = oneOf(b.visibility ?? 'public', ['public', 'members'] as const, 'visibilidade');
  // Só mexe na capa quando a tela mandou o campo.
  const trocaCapa = b.poster_id !== undefined;
  const capa = trocaCapa ? await optionalMedia(c.env, b.poster_id, u, ['cover', 'poster']) : null;
  const campos = ['title = ?', 'description = ?', 'category = ?', 'speaker = ?', 'visibility = ?', 'hidden = ?', 'vertical = ?'];
  const binds: unknown[] = [
    reqStr(b.title, 200, 'o título'),
    str(b.description, 2000, { label: 'descrição' }),
    str(b.category, 60, { label: 'categoria' }),
    str(b.speaker, 80, { label: 'pregador' }),
    visibility,
    bool(b.hidden) ? 1 : 0,
    bool(b.vertical) ? 1 : 0,
  ];
  if (trocaCapa) {
    campos.push('poster_id = ?');
    binds.push(capa);
  }
  const stmts = [c.env.DB.prepare(`UPDATE videos SET ${campos.join(', ')} WHERE id = ?`).bind(...binds, id)];
  if (v.media_id)
    stmts.push(c.env.DB.prepare('UPDATE media SET access = ? WHERE id IN (?, ?)').bind(visibility, v.media_id, capa ?? v.poster_id ?? ''));
  const usada = capa ? useMediaStmt(c.env, [capa]) : null;
  if (usada) stmts.push(usada, c.env.DB.prepare('UPDATE media SET access = ? WHERE id = ?').bind(visibility, capa));
  await c.env.DB.batch(stmts);
  if (trocaCapa && v.poster_id && v.poster_id !== capa) await deleteMedia(c.env, [v.poster_id]);
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
  if (r.added) c.executionCtx.waitUntil(drain(c.env, originOf(c), 15).catch(() => undefined));
  return c.json(r);
});
