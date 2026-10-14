/** Mensagem do Pastor (diária), pregações em áudio e mural de ajuda mútua. */
import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../types';
import {
  auditLog,
  body,
  bool,
  dateStr,
  fail,
  httpsUrl,
  int,
  clientIp,
  isLeader,
  needLeader,
  needMedia,
  needMember,
  now,
  oneOf,
  originOf,
  rateLimit,
  reqStr,
  spParts,
  str,
  visibleSet,
} from '../util';
import { deleteMedia, optionalMedia } from '../storage';
import { notifyNow } from '../push';
import { youtubeId } from './videos';

export const extrasRoutes = new Hono<AppEnv>();

const VIS = ['public', 'members'] as const;
const wait = (c: Ctx) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
const inList = (vals: readonly string[]) => `(${vals.map(() => '?').join(',')})`;

/** Liga os arquivos ao conteúdo: ficam "em uso" e com a mesma visibilidade. */
function attachStmt(c: Ctx, ids: (string | null)[], access: string) {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return null;
  return c.env.DB.prepare(`UPDATE media SET access = ?, used = 1 WHERE id IN ${inList(list)}`).bind(access, ...list);
}

/** Link de mídia: YouTube ou um arquivo de áudio/vídeo em https. */
function mediaLink(v: unknown, label: string): string | null {
  const url = httpsUrl(v, label);
  if (!url) return null;
  if (youtubeId(url)) return url;
  if (!url.startsWith('https://')) fail(400, `${label}: use um link começando com https://`);
  return url;
}

// =============== MENSAGEM DO PASTOR ===============

extrasRoutes.get('/mensagens', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const today = spParts(now()).ymd;
  const future = isLeader(u) && c.req.query('futuras') === '1';
  const before = dateStr(c.req.query('antes'), 'data');
  const conds = [`visibility IN ${inList(vis)}`];
  const binds: unknown[] = [...vis];
  if (!future) {
    conds.push('day <= ?');
    binds.push(today);
  }
  if (before) {
    conds.push('day < ?');
    binds.push(before);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, m.duration AS audio_duration FROM pastor_messages p LEFT JOIN media m ON m.id = p.audio_id
     WHERE ${conds.map((x) => `p.${x}`).join(' AND ')} ORDER BY p.day DESC, p.id DESC LIMIT 30`,
  )
    .bind(...binds)
    .all();
  return c.json({ messages: results, today });
});

extrasRoutes.get('/mensagens/:id{[0-9]+}', async (c) => {
  const u = c.get('user');
  const m = await c.env.DB.prepare(
    'SELECT p.*, md.duration AS audio_duration FROM pastor_messages p LEFT JOIN media md ON md.id = p.audio_id WHERE p.id = ?',
  )
    .bind(Number(c.req.param('id')))
    .first<{ visibility: string; day: string }>();
  if (!m || !visibleSet(u).includes(m.visibility)) fail(404, 'Mensagem não encontrada.');
  if (m.day > spParts(now()).ymd && !isLeader(u)) fail(404, 'Mensagem não encontrada.');
  return c.json({ message: m });
});

function readMessage(b: Record<string, unknown>) {
  return {
    day: dateStr(b.day, 'dia') ?? spParts(now()).ymd,
    title: reqStr(b.title, 120, 'o título'),
    reference: str(b.reference, 80, { label: 'referência bíblica' }),
    verse: str(b.verse, 1200, { label: 'versículo' }),
    body: str(b.body, 12000, { label: 'mensagem' }),
    author: str(b.author, 80, { label: 'autor' }),
    media_url: mediaLink(b.media_url, 'Link do áudio ou vídeo'),
    visibility: oneOf(b.visibility ?? 'public', VIS, 'visibilidade'),
  };
}

extrasRoutes.post('/mensagens', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const m = readMessage(b);
  if (!m.body && !m.media_url && !b.audio_id) fail(400, 'Escreva a mensagem ou anexe um áudio/vídeo.');
  const image = await optionalMedia(c.env, b.image_id, u, ['cover']);
  const audio = await optionalMedia(c.env, b.audio_id, u, ['audio']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO pastor_messages (day, title, reference, verse, body, author, image_id, audio_id, media_url, visibility, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(m.day, m.title, m.reference, m.verse, m.body, m.author, image, audio, m.media_url, m.visibility, u.id, t, t),
  ];
  const as = attachStmt(c, [image, audio], m.visibility);
  if (as) stmts.push(as);
  const res = await c.env.DB.batch(stmts);
  const id = res[0].meta.last_row_id;
  // Se for para hoje e já passou da hora do lembrete, pode avisar na hora (senão a tarefa automática avisa de manhã).
  if (bool(b.notify) && m.day === spParts(t).ymd) {
    await c.env.DB.prepare('UPDATE pastor_messages SET notified = 1 WHERE id = ?').bind(id).run();
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'palavra',
      audience: m.visibility === 'public' ? 'all' : 'members',
      title: `Mensagem do Pastor: ${m.title}`,
      body: m.reference ?? (m.body ? m.body.slice(0, 120) : 'Toque para ouvir.'),
      url: `/mensagem/${id}`,
      createdBy: u.id,
    });
  }
  return c.json({ id });
});

extrasRoutes.put('/mensagens/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id, audio_id FROM pastor_messages WHERE id = ?')
    .bind(id)
    .first<{ image_id: string | null; audio_id: string | null }>();
  if (!old) fail(404, 'Mensagem não encontrada.');
  const b = await body(c);
  const m = readMessage(b);
  const image = b.image_id === old.image_id ? old.image_id : await optionalMedia(c.env, b.image_id, u, ['cover']);
  const audio = b.audio_id === old.audio_id ? old.audio_id : await optionalMedia(c.env, b.audio_id, u, ['audio']);
  if (!m.body && !m.media_url && !audio) fail(400, 'Escreva a mensagem ou anexe um áudio/vídeo.');
  const stmts = [
    c.env.DB.prepare(
      `UPDATE pastor_messages SET day = ?, title = ?, reference = ?, verse = ?, body = ?, author = ?, image_id = ?, audio_id = ?,
         media_url = ?, visibility = ?, notified = CASE WHEN day != ? THEN 0 ELSE notified END, updated_at = ? WHERE id = ?`,
    ).bind(m.day, m.title, m.reference, m.verse, m.body, m.author, image, audio, m.media_url, m.visibility, m.day, now(), id),
  ];
  const as = attachStmt(c, [image, audio], m.visibility);
  if (as) stmts.push(as);
  await c.env.DB.batch(stmts);
  await deleteMedia(c.env, [old.image_id !== image ? old.image_id : null, old.audio_id !== audio ? old.audio_id : null]);
  return c.json({ ok: true });
});

extrasRoutes.delete('/mensagens/:id{[0-9]+}', async (c) => {
  needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id, audio_id FROM pastor_messages WHERE id = ?')
    .bind(id)
    .first<{ image_id: string | null; audio_id: string | null }>();
  if (!old) fail(404, 'Mensagem não encontrada.');
  await c.env.DB.prepare('DELETE FROM pastor_messages WHERE id = ?').bind(id).run();
  await deleteMedia(c.env, [old.image_id, old.audio_id]);
  return c.json({ ok: true });
});

// =============== PREGAÇÕES EM ÁUDIO ===============

extrasRoutes.get('/pregacoes', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const q = str(c.req.query('q'), 80, { label: 'busca' });
  const before = int(c.req.query('antes'), 1, 1e12, 'cursor');
  const conds = [`visibility IN ${inList(vis)}`];
  const binds: unknown[] = [...vis];
  if (q) {
    conds.push("(title LIKE ? ESCAPE '\\' OR preacher LIKE ? ESCAPE '\\' OR reference LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    binds.push(like, like, like);
  }
  if (before) {
    conds.push('id < ?');
    binds.push(before);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM sermons WHERE ${conds.join(' AND ')} ORDER BY preached_on DESC, id DESC LIMIT 31`,
  )
    .bind(...binds)
    .all<{ id: number }>();
  const more = results.length > 30;
  return c.json({ sermons: results.slice(0, 30), more });
});

extrasRoutes.get('/pregacoes/:id{[0-9]+}', async (c) => {
  const s = await c.env.DB.prepare('SELECT * FROM sermons WHERE id = ?').bind(Number(c.req.param('id'))).first<{ visibility: string }>();
  if (!s || !visibleSet(c.get('user')).includes(s.visibility)) fail(404, 'Pregação não encontrada.');
  return c.json({ sermon: s });
});

extrasRoutes.post('/pregacoes/:id{[0-9]+}/ouvir', async (c) => {
  const id = Number(c.req.param('id'));
  const who = c.get('user')?.id ?? clientIp(c);
  // Conta no máximo uma vez por pessoa a cada dia.
  const r = await c.env.DB.prepare('INSERT INTO marks (key, created_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING')
    .bind(`ouvir:${id}:${who}:${spParts(now()).ymd}`, now())
    .run();
  if (r.meta.changes) await c.env.DB.prepare('UPDATE sermons SET plays = plays + 1 WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

function readSermon(b: Record<string, unknown>) {
  const yt = str(b.youtube, 300, { label: 'link do YouTube' });
  const youtube = yt ? youtubeId(yt) : null;
  if (yt && !youtube) fail(400, 'Link do YouTube inválido.');
  const audioUrl = httpsUrl(b.audio_url, 'Link do áudio');
  if (audioUrl && !audioUrl.startsWith('https://')) fail(400, 'Link do áudio: use um link começando com https://');
  const dur = typeof b.duration === 'number' && isFinite(b.duration) && b.duration > 0 ? Math.min(b.duration, 86400) : null;
  return {
    title: reqStr(b.title, 140, 'o título'),
    preacher: str(b.preacher, 80, { label: 'pregador' }),
    reference: str(b.reference, 80, { label: 'referência bíblica' }),
    description: str(b.description, 4000, { label: 'descrição' }),
    preached_on: dateStr(b.preached_on, 'data') ?? spParts(now()).ymd,
    audio_url: audioUrl,
    youtube_id: youtube,
    duration: dur,
    visibility: oneOf(b.visibility ?? 'public', VIS, 'visibilidade'),
  };
}

extrasRoutes.post('/pregacoes', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const s = readSermon(b);
  const audio = await optionalMedia(c.env, b.audio_id, u, ['audio']);
  if (!audio && !s.audio_url && !s.youtube_id) fail(400, 'Envie o áudio, ou cole um link de áudio ou do YouTube.');
  const cover = await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO sermons (title, preacher, reference, description, preached_on, audio_id, audio_url, youtube_id, cover_id, duration, visibility, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      s.title,
      s.preacher,
      s.reference,
      s.description,
      s.preached_on,
      audio,
      s.audio_url,
      s.youtube_id,
      cover,
      s.duration,
      s.visibility,
      u.id,
      t,
      t,
    ),
  ];
  const as = attachStmt(c, [audio, cover], s.visibility);
  if (as) stmts.push(as);
  const res = await c.env.DB.batch(stmts);
  const id = res[0].meta.last_row_id;
  if (bool(b.notify)) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'avisos',
      audience: s.visibility === 'public' ? 'all' : 'members',
      title: `Nova pregação: ${s.title}`,
      body: [s.preacher, s.reference].filter(Boolean).join(' · ') || 'Toque para ouvir.',
      url: `/pregacoes/${id}`,
      createdBy: u.id,
    });
  }
  return c.json({ id });
});

extrasRoutes.put('/pregacoes/:id{[0-9]+}', async (c) => {
  const u = needMedia(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT audio_id, cover_id FROM sermons WHERE id = ?')
    .bind(id)
    .first<{ audio_id: string | null; cover_id: string | null }>();
  if (!old) fail(404, 'Pregação não encontrada.');
  const b = await body(c);
  const s = readSermon(b);
  const audio = b.audio_id === old.audio_id ? old.audio_id : await optionalMedia(c.env, b.audio_id, u, ['audio']);
  const cover = b.cover_id === old.cover_id ? old.cover_id : await optionalMedia(c.env, b.cover_id, u, ['cover']);
  if (!audio && !s.audio_url && !s.youtube_id) fail(400, 'Envie o áudio, ou cole um link de áudio ou do YouTube.');
  const stmts = [
    c.env.DB.prepare(
      `UPDATE sermons SET title = ?, preacher = ?, reference = ?, description = ?, preached_on = ?, audio_id = ?, audio_url = ?,
         youtube_id = ?, cover_id = ?, duration = COALESCE(?, duration), visibility = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      s.title,
      s.preacher,
      s.reference,
      s.description,
      s.preached_on,
      audio,
      s.audio_url,
      s.youtube_id,
      cover,
      s.duration,
      s.visibility,
      now(),
      id,
    ),
  ];
  const as = attachStmt(c, [audio, cover], s.visibility);
  if (as) stmts.push(as);
  await c.env.DB.batch(stmts);
  await deleteMedia(c.env, [old.audio_id !== audio ? old.audio_id : null, old.cover_id !== cover ? old.cover_id : null]);
  return c.json({ ok: true });
});

extrasRoutes.delete('/pregacoes/:id{[0-9]+}', async (c) => {
  needMedia(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT audio_id, cover_id FROM sermons WHERE id = ?')
    .bind(id)
    .first<{ audio_id: string | null; cover_id: string | null }>();
  if (!old) fail(404, 'Pregação não encontrada.');
  await c.env.DB.prepare('DELETE FROM sermons WHERE id = ?').bind(id).run();
  await deleteMedia(c.env, [old.audio_id, old.cover_id]);
  return c.json({ ok: true });
});

// =============== MURAL DE AJUDA MÚTUA ===============

const HELP_KINDS = ['preciso', 'ofereco'] as const;
const HELP_CATEGORIES = ['alimentos', 'emprego', 'servicos', 'doacao', 'carona', 'moradia', 'estudos', 'saude', 'outros'] as const;
const HELP_SELECT = `SELECT h.*, u.name AS author_name, u.picture AS author_picture FROM help_posts h LEFT JOIN users u ON u.id = h.user_id`;

extrasRoutes.get('/ajuda', async (c) => {
  const u = needMember(c);
  const filtro = c.req.query('filtro') ?? 'mural';
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (filtro === 'meus') {
    conds.push('h.user_id = ?');
    binds.push(u.id);
  } else if (filtro === 'pendentes') {
    if (!isLeader(u)) fail(403, 'Só a liderança modera o mural.');
    conds.push("h.status = 'pendente'");
  } else {
    conds.push("h.status = 'aprovado'");
    const kind = c.req.query('tipo');
    if (kind === 'preciso' || kind === 'ofereco') {
      conds.push('h.kind = ?');
      binds.push(kind);
    }
    const cat = c.req.query('categoria');
    if (cat && (HELP_CATEGORIES as readonly string[]).includes(cat)) {
      conds.push('h.category = ?');
      binds.push(cat);
    }
  }
  const { results } = await c.env.DB.prepare(`${HELP_SELECT} WHERE ${conds.join(' AND ')} ORDER BY h.id DESC LIMIT 60`)
    .bind(...binds)
    .all<Record<string, unknown> & { user_id: number }>();
  // O mural é anônimo: só a liderança (e a própria pessoa) vê quem publicou e o contato.
  const leader = isLeader(u);
  const posts = results.map((p) => {
    const mine = p.user_id === u.id;
    if (leader || mine) return { ...p, mine };
    return { ...p, mine, user_id: null, author_name: null, author_picture: null, contact: null };
  });
  return c.json({ posts, anonymous: !leader });
});

function readHelp(b: Record<string, unknown>) {
  const contact = str(b.contact, 120, { label: 'contato' });
  return {
    kind: oneOf(b.kind, HELP_KINDS, 'tipo'),
    category: oneOf(b.category ?? 'outros', HELP_CATEGORIES, 'categoria'),
    title: reqStr(b.title, 100, 'o título'),
    body: str(b.body, 1500, { label: 'descrição' }),
    contact,
  };
}

extrasRoutes.post('/ajuda', async (c) => {
  const u = needMember(c);
  const b = await body(c);
  const h = readHelp(b);
  await rateLimit(c.env, `help:${u.id}`, 6, 24 * 3600_000);
  const t = now();
  // A liderança publica direto; os outros pedidos passam pela moderação.
  const status = isLeader(u) ? 'aprovado' : 'pendente';
  const res = await c.env.DB.prepare(
    `INSERT INTO help_posts (user_id, kind, category, title, body, contact, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(u.id, h.kind, h.category, h.title, h.body, h.contact, status, t, t)
    .run();
  if (status === 'pendente') {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'admin',
      audience: 'leaders',
      title: 'Mural de ajuda: novo pedido para aprovar',
      body: `${u.name}: ${h.title}`.slice(0, 200),
      url: '/ajuda?filtro=pendentes',
    });
  }
  return c.json({ id: res.meta.last_row_id, status });
});

async function ownPost(c: Ctx, id: number) {
  const u = needMember(c);
  const p = await c.env.DB.prepare('SELECT * FROM help_posts WHERE id = ?').bind(id).first<{ user_id: number; status: string; title: string }>();
  if (!p) fail(404, 'Publicação não encontrada.');
  if (p.user_id !== u.id && !isLeader(u)) fail(403, 'Esta publicação é de outra pessoa.');
  return { u, p };
}

extrasRoutes.put('/ajuda/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  const { u, p } = await ownPost(c, id);
  const h = readHelp(await body(c));
  // Quem edita volta para a fila de moderação (menos a liderança).
  const status = isLeader(u) ? (p.status === 'pendente' ? 'aprovado' : p.status) : p.status === 'resolvido' ? 'resolvido' : 'pendente';
  await c.env.DB.prepare(
    'UPDATE help_posts SET kind = ?, category = ?, title = ?, body = ?, contact = ?, status = ?, updated_at = ? WHERE id = ?',
  )
    .bind(h.kind, h.category, h.title, h.body, h.contact, status, now(), id)
    .run();
  return c.json({ ok: true, status });
});

extrasRoutes.post('/ajuda/:id{[0-9]+}/resolvido', async (c) => {
  const id = Number(c.req.param('id'));
  const { p } = await ownPost(c, id);
  const done = p.status !== 'resolvido';
  await c.env.DB.prepare('UPDATE help_posts SET status = ?, resolved_at = ?, updated_at = ? WHERE id = ?')
    .bind(done ? 'resolvido' : 'aprovado', done ? now() : null, now(), id)
    .run();
  return c.json({ ok: true, status: done ? 'resolvido' : 'aprovado' });
});

/** Alguém quer ajudar (ou aceitar uma oferta): a liderança é avisada com o nome e faz a ponte, sem expor quem pediu. */
extrasRoutes.post('/ajuda/:id{[0-9]+}/interesse', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const p = await c.env.DB.prepare("SELECT user_id, kind, title FROM help_posts WHERE id = ? AND status = 'aprovado'")
    .bind(id)
    .first<{ user_id: number; kind: string; title: string }>();
  if (!p) fail(404, 'Publicação não encontrada.');
  if (p.user_id === u.id) fail(400, 'Esta publicação é sua.');
  try {
    await rateLimit(c.env, `help-int:${u.id}:${id}`, 1, 24 * 3600_000);
  } catch {
    fail(400, 'Você já avisou a liderança sobre esta publicação. Eles vão entrar em contato.');
  }
  const msg = str((await c.req.json().catch(() => ({})) as Record<string, unknown>).message, 300, { label: 'mensagem' });
  const verb = p.kind === 'preciso' ? 'quer ajudar' : 'tem interesse na oferta';
  await c.env.DB.batch([auditLog(c, u.id, 'ajuda.interesse', `#${id} ${p.title}${msg ? ` — ${msg}` : ''}`)]);
  await notifyNow(c.env, originOf(c), wait(c), {
    topic: 'admin',
    audience: 'leaders',
    title: `Mural de ajuda: ${u.name} ${verb}`,
    body: `${p.title}${msg ? ` — "${msg}"` : ''}${u.phone ? ` · Tel.: ${u.phone}` : ''}`.slice(0, 250),
    url: `/ajuda?filtro=interesses`,
  });
  await notifyNow(c.env, originOf(c), wait(c), {
    topic: 'pessoal',
    audience: `user:${p.user_id}`,
    title: p.kind === 'preciso' ? 'Alguém da igreja quer te ajudar' : 'Alguém se interessou pela sua oferta',
    body: `A liderança vai entrar em contato com você. (${p.title})`.slice(0, 200),
    url: '/ajuda?filtro=meus',
  });
  return c.json({ ok: true });
});

/** Lista para a liderança: quem se ofereceu para ajudar em cada publicação. */
extrasRoutes.get('/ajuda/interesses', async (c) => {
  needLeader(c);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.detail, a.created_at, u.name, u.phone, u.picture FROM audit a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.action = 'ajuda.interesse' ORDER BY a.id DESC LIMIT 60`,
  ).all();
  return c.json({ items: results });
});

extrasRoutes.post('/ajuda/:id{[0-9]+}/moderar', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  const decision = oneOf(b.status, ['aprovado', 'recusado'] as const, 'decisão');
  const note = str(b.note, 300, { label: 'observação' });
  const p = await c.env.DB.prepare('SELECT user_id, title FROM help_posts WHERE id = ?').bind(id).first<{ user_id: number; title: string }>();
  if (!p) fail(404, 'Publicação não encontrada.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE help_posts SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?').bind(
      decision,
      note,
      u.id,
      now(),
      now(),
      id,
    ),
    auditLog(c, u.id, `ajuda.${decision}`, `#${id} ${p.title}`),
  ]);
  if (p.user_id !== u.id) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'pessoal',
      audience: `user:${p.user_id}`,
      title: decision === 'aprovado' ? 'Sua publicação está no mural de ajuda' : 'Sua publicação no mural de ajuda não foi aprovada',
      body: note ?? p.title,
      url: '/ajuda?filtro=meus',
    });
  }
  return c.json({ ok: true });
});

extrasRoutes.delete('/ajuda/:id{[0-9]+}', async (c) => {
  const id = Number(c.req.param('id'));
  await ownPost(c, id);
  await c.env.DB.prepare('DELETE FROM help_posts WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

