/** Vida da igreja: agenda, mural de avisos, Palavra do dia, campanhas e ministérios (células, Casa de Paz...). */
import { Hono } from 'hono';
import type { AppEnv, Ctx, Env, User } from '../types';
import {
  addDays,
  auditLog,
  body,
  bool,
  dateStr,
  fail,
  hhmm,
  httpsUrl,
  int,
  isLeader,
  isMember,
  needLeader,
  needMember,
  now,
  oneOf,
  originOf,
  rateLimit,
  reqStr,
  spParts,
  spToMs,
  str,
  visibleSet,
} from '../util';
import { deleteMedia, optionalMedia } from '../storage';
import { notifyNow } from '../push';

export const communityRoutes = new Hono<AppEnv>();

const VIS = ['public', 'members'] as const;
const pad = (n: number) => String(n).padStart(2, '0');

export function fmtWhen(ms: number): string {
  const p = spParts(ms);
  return `${pad(p.day)}/${pad(p.month)} às ${p.hour}h${p.minute ? pad(p.minute) : ''}`;
}

function inList(vals: readonly string[]) {
  return `(${vals.map(() => '?').join(',')})`;
}

function coverStmt(env: Env, id: string | null, access: string) {
  return id ? env.DB.prepare('UPDATE media SET access = ?, used = 1 WHERE id = ?').bind(access, id) : null;
}

function wait(c: Ctx) {
  return (p: Promise<unknown>) => c.executionCtx.waitUntil(p);
}

// =============== AGENDA ===============

interface EventRow {
  id: number;
  title: string;
  starts_at: number;
  ends_at: number | null;
  visibility: string;
  cover_id: string | null;
  capacity: number | null;
  rsvp: number;
  canceled: number;
}

const EVENT_SELECT = `SELECT e.*,
  (SELECT COUNT(*) + COALESCE(SUM(r.guests), 0) FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'vou') AS going,
  (SELECT status FROM event_rsvps r WHERE r.event_id = e.id AND r.user_id = ?) AS my_rsvp
  FROM events e`;

communityRoutes.get('/eventos', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const past = c.req.query('periodo') === 'passados';
  const t = now();
  const { results } = await c.env.DB.prepare(
    `${EVENT_SELECT} WHERE e.visibility IN ${inList(vis)} AND COALESCE(e.ends_at, e.starts_at + 10800000) ${past ? '<' : '>='} ?
     ORDER BY e.starts_at ${past ? 'DESC' : 'ASC'} LIMIT 60`,
  )
    .bind(u?.id ?? 0, ...vis, t)
    .all();
  return c.json({ events: results });
});

communityRoutes.get('/eventos/:id{[0-9]+}', async (c) => {
  const u = c.get('user');
  const e = await c.env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`)
    .bind(u?.id ?? 0, Number(c.req.param('id')))
    .first<EventRow>();
  if (!e || !visibleSet(u).includes(e.visibility)) fail(404, 'Evento não encontrado.');
  let attendees: unknown[] = [];
  if (isLeader(u)) {
    const r = await c.env.DB.prepare(
      `SELECT r.status, r.guests, u.name, u.phone FROM event_rsvps r JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ? ORDER BY r.status, u.name`,
    )
      .bind(e.id)
      .all();
    attendees = r.results;
  }
  return c.json({ event: e, attendees });
});

function readEvent(b: Record<string, unknown>) {
  const date = dateStr(b.date, 'data');
  const time = hhmm(b.time, 'horário');
  if (!date || !time) fail(400, 'Informe a data e o horário do evento.');
  const startsAt = spToMs(date, time);
  let endsAt: number | null = null;
  const endTime = hhmm(b.end_time, 'horário de término');
  if (endTime) {
    const endDate = dateStr(b.end_date, 'data de término') ?? date;
    endsAt = spToMs(endDate, endTime);
    if (endsAt <= startsAt) fail(400, 'O término precisa ser depois do início.');
  }
  return {
    title: reqStr(b.title, 120, 'o nome do evento'),
    description: str(b.description, 4000, { label: 'descrição' }),
    category: str(b.category, 40, { label: 'categoria' }),
    startsAt,
    endsAt,
    location: str(b.location, 200, { label: 'local' }),
    visibility: oneOf(b.visibility ?? 'public', VIS, 'visibilidade'),
    rsvp: b.rsvp === undefined ? 1 : bool(b.rsvp) ? 1 : 0,
    capacity: int(b.capacity, 1, 100000, 'vagas'),
  };
}

communityRoutes.post('/eventos', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const e = readEvent(b);
  const cover = await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO events (title, description, category, starts_at, ends_at, location, cover_id, visibility, rsvp, capacity, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(e.title, e.description, e.category, e.startsAt, e.endsAt, e.location, cover, e.visibility, e.rsvp, e.capacity, u.id, t, t),
  ];
  const cs = coverStmt(c.env, cover, e.visibility);
  if (cs) stmts.push(cs);
  const res = await c.env.DB.batch(stmts);
  const id = res[0].meta.last_row_id;
  if (bool(b.notify)) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'eventos',
      audience: e.visibility === 'public' ? 'all' : 'members',
      title: `Novo evento: ${e.title}`,
      body: `${fmtWhen(e.startsAt)}${e.location ? ` · ${e.location}` : ''}`,
      url: `/agenda/${id}`,
      createdBy: u.id,
    });
  }
  return c.json({ id });
});

communityRoutes.put('/eventos/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
  if (!old) fail(404, 'Evento não encontrado.');
  const b = await body(c);
  const e = readEvent(b);
  const cover = b.cover_id === old.cover_id ? old.cover_id : await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const stmts = [
    c.env.DB.prepare(
      `UPDATE events SET title = ?, description = ?, category = ?, starts_at = ?, ends_at = ?, location = ?, cover_id = ?,
         visibility = ?, rsvp = ?, capacity = ?, canceled = ?, reminded = CASE WHEN starts_at != ? THEN 0 ELSE reminded END, updated_at = ?
       WHERE id = ?`,
    ).bind(
      e.title,
      e.description,
      e.category,
      e.startsAt,
      e.endsAt,
      e.location,
      cover,
      e.visibility,
      e.rsvp,
      e.capacity,
      bool(b.canceled) ? 1 : 0,
      e.startsAt,
      now(),
      id,
    ),
  ];
  const cs = coverStmt(c.env, cover, e.visibility);
  if (cs) stmts.push(cs);
  await c.env.DB.batch(stmts);
  if (old.cover_id && old.cover_id !== cover) await deleteMedia(c.env, [old.cover_id]);
  if (bool(b.canceled) && !old.canceled) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'eventos',
      audience: e.visibility === 'public' ? 'all' : 'members',
      title: `Evento cancelado: ${e.title}`,
      body: `O evento de ${fmtWhen(e.startsAt)} foi cancelado.`,
      url: `/agenda/${id}`,
      createdBy: u.id,
    });
  }
  return c.json({ ok: true });
});

communityRoutes.delete('/eventos/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
  if (!old) fail(404, 'Evento não encontrado.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM event_rsvps WHERE event_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id),
    auditLog(c, u.id, 'evento_excluido', old.title),
  ]);
  await deleteMedia(c.env, [old.cover_id]);
  return c.json({ ok: true });
});

communityRoutes.post('/eventos/:id{[0-9]+}/presenca', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const e = await c.env.DB.prepare(`${EVENT_SELECT} WHERE e.id = ?`).bind(u.id, id).first<EventRow & { going: number; my_rsvp: string | null }>();
  if (!e) fail(404, 'Evento não encontrado.');
  if (!e.rsvp) fail(400, 'Este evento não usa confirmação de presença.');
  if (e.canceled) fail(400, 'Este evento foi cancelado.');
  const b = await body(c);
  const status = oneOf(b.status, ['vou', 'talvez', 'nao'] as const, 'presença');
  const guests = status === 'vou' ? int(b.guests, 0, 20, 'acompanhantes') ?? 0 : 0;
  if (status === 'vou' && e.capacity) {
    const mine = await c.env.DB.prepare("SELECT 1 + guests AS n FROM event_rsvps WHERE event_id = ? AND user_id = ? AND status = 'vou'")
      .bind(id, u.id)
      .first<{ n: number }>();
    const others = e.going - (mine?.n ?? 0);
    if (others + 1 + guests > e.capacity) fail(409, 'As vagas deste evento acabaram.');
  }
  await c.env.DB.prepare(
    `INSERT INTO event_rsvps (event_id, user_id, status, guests, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status, guests = excluded.guests`,
  )
    .bind(id, u.id, status, guests, now())
    .run();
  return c.json({ ok: true });
});

// =============== MURAL DE AVISOS ===============

communityRoutes.get('/avisos', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const today = spParts(now()).ymd;
  const all = isLeader(u) && c.req.query('todos') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT n.*, u.name AS author_name FROM notices n LEFT JOIN users u ON u.id = n.created_by
     WHERE n.visibility IN ${inList(vis)} ${all ? '' : 'AND (n.expires_on IS NULL OR n.expires_on >= ?)'}
     ORDER BY n.pinned DESC, n.id DESC LIMIT 60`,
  )
    .bind(...vis, ...(all ? [] : [today]))
    .all();
  return c.json({ notices: results });
});

function readNotice(b: Record<string, unknown>) {
  return {
    title: reqStr(b.title, 120, 'o título'),
    body: str(b.body, 4000, { label: 'texto' }),
    link: httpsUrl(b.link, 'link'),
    pinned: bool(b.pinned) ? 1 : 0,
    visibility: oneOf(b.visibility ?? 'members', VIS, 'visibilidade'),
    expires_on: dateStr(b.expires_on, 'data de validade'),
  };
}

communityRoutes.post('/avisos', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const n = readNotice(b);
  const image = await optionalMedia(c.env, b.image_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      'INSERT INTO notices (title, body, image_id, link, pinned, visibility, expires_on, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(n.title, n.body, image, n.link, n.pinned, n.visibility, n.expires_on, u.id, t, t),
  ];
  const cs = coverStmt(c.env, image, n.visibility);
  if (cs) stmts.push(cs);
  const res = await c.env.DB.batch(stmts);
  if (bool(b.notify)) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'avisos',
      audience: n.visibility === 'public' ? 'all' : 'members',
      title: n.title,
      body: (n.body ?? '').slice(0, 140),
      url: '/avisos',
      createdBy: u.id,
    });
  }
  return c.json({ id: res[0].meta.last_row_id });
});

communityRoutes.put('/avisos/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id FROM notices WHERE id = ?').bind(id).first<{ image_id: string | null }>();
  if (!old) fail(404, 'Aviso não encontrado.');
  const b = await body(c);
  const n = readNotice(b);
  const image = b.image_id === old.image_id ? old.image_id : await optionalMedia(c.env, b.image_id, u, ['cover']);
  const stmts = [
    c.env.DB.prepare(
      'UPDATE notices SET title = ?, body = ?, image_id = ?, link = ?, pinned = ?, visibility = ?, expires_on = ?, updated_at = ? WHERE id = ?',
    ).bind(n.title, n.body, image, n.link, n.pinned, n.visibility, n.expires_on, now(), id),
  ];
  const cs = coverStmt(c.env, image, n.visibility);
  if (cs) stmts.push(cs);
  await c.env.DB.batch(stmts);
  if (old.image_id && old.image_id !== image) await deleteMedia(c.env, [old.image_id]);
  return c.json({ ok: true });
});

communityRoutes.delete('/avisos/:id{[0-9]+}', async (c) => {
  needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id FROM notices WHERE id = ?').bind(id).first<{ image_id: string | null }>();
  if (!old) fail(404, 'Aviso não encontrado.');
  await c.env.DB.prepare('DELETE FROM notices WHERE id = ?').bind(id).run();
  await deleteMedia(c.env, [old.image_id]);
  return c.json({ ok: true });
});

// =============== PALAVRA DO DIA ===============

communityRoutes.get('/palavra', async (c) => {
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
  const { results } = await c.env.DB.prepare(`SELECT * FROM words WHERE ${conds.join(' AND ')} ORDER BY day DESC, id DESC LIMIT 30`)
    .bind(...binds)
    .all();
  return c.json({ words: results, today });
});

communityRoutes.get('/palavra/:id{[0-9]+}', async (c) => {
  const u = c.get('user');
  const w = await c.env.DB.prepare('SELECT * FROM words WHERE id = ?').bind(Number(c.req.param('id'))).first<{ visibility: string; day: string }>();
  if (!w || !visibleSet(u).includes(w.visibility)) fail(404, 'Palavra não encontrada.');
  if (w.day > spParts(now()).ymd && !isLeader(u)) fail(404, 'Palavra não encontrada.');
  return c.json({ word: w });
});

function readWord(b: Record<string, unknown>) {
  return {
    day: dateStr(b.day, 'dia') ?? spParts(now()).ymd,
    title: reqStr(b.title, 120, 'o título'),
    reference: str(b.reference, 80, { label: 'referência bíblica' }),
    verse: str(b.verse, 1200, { label: 'versículo' }),
    body: str(b.body, 8000, { label: 'mensagem' }),
    author: str(b.author, 80, { label: 'autor' }),
    visibility: oneOf(b.visibility ?? 'public', VIS, 'visibilidade'),
  };
}

communityRoutes.post('/palavra', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const w = readWord(b);
  const image = await optionalMedia(c.env, b.image_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      'INSERT INTO words (day, title, reference, verse, body, author, image_id, visibility, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(w.day, w.title, w.reference, w.verse, w.body, w.author, image, w.visibility, u.id, t, t),
  ];
  const cs = coverStmt(c.env, image, w.visibility);
  if (cs) stmts.push(cs);
  const res = await c.env.DB.batch(stmts);
  return c.json({ id: res[0].meta.last_row_id });
});

communityRoutes.put('/palavra/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id, day FROM words WHERE id = ?').bind(id).first<{ image_id: string | null; day: string }>();
  if (!old) fail(404, 'Palavra não encontrada.');
  const b = await body(c);
  const w = readWord(b);
  const image = b.image_id === old.image_id ? old.image_id : await optionalMedia(c.env, b.image_id, u, ['cover']);
  const stmts = [
    c.env.DB.prepare(
      `UPDATE words SET day = ?, title = ?, reference = ?, verse = ?, body = ?, author = ?, image_id = ?, visibility = ?,
         notified = CASE WHEN day != ? THEN 0 ELSE notified END, updated_at = ? WHERE id = ?`,
    ).bind(w.day, w.title, w.reference, w.verse, w.body, w.author, image, w.visibility, w.day, now(), id),
  ];
  const cs = coverStmt(c.env, image, w.visibility);
  if (cs) stmts.push(cs);
  await c.env.DB.batch(stmts);
  if (old.image_id && old.image_id !== image) await deleteMedia(c.env, [old.image_id]);
  return c.json({ ok: true });
});

communityRoutes.delete('/palavra/:id{[0-9]+}', async (c) => {
  needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT image_id FROM words WHERE id = ?').bind(id).first<{ image_id: string | null }>();
  if (!old) fail(404, 'Palavra não encontrada.');
  await c.env.DB.prepare('DELETE FROM words WHERE id = ?').bind(id).run();
  await deleteMedia(c.env, [old.image_id]);
  return c.json({ ok: true });
});

// =============== CAMPANHAS ===============

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

const CAMPAIGN_SELECT = `SELECT c.*,
  (SELECT COUNT(*) FROM campaign_members m WHERE m.campaign_id = c.id) AS members,
  EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = ?) AS joined,
  (SELECT COUNT(*) FROM campaign_checkins k WHERE k.campaign_id = c.id AND k.user_id = ?) AS my_checkins
  FROM campaigns c`;

communityRoutes.get('/campanhas', async (c) => {
  const u = c.get('user');
  const vis = visibleSet(u);
  const { results } = await c.env.DB.prepare(`${CAMPAIGN_SELECT} WHERE c.visibility IN ${inList(vis)} ORDER BY c.end_date DESC LIMIT 40`)
    .bind(u?.id ?? 0, u?.id ?? 0, ...vis)
    .all<{ start_date: string; end_date: string }>();
  return c.json({
    campaigns: results.map((r) => ({ ...r, days_total: daysBetween(r.start_date, r.end_date) })),
    today: spParts(now()).ymd,
  });
});

communityRoutes.get('/campanhas/:id{[0-9]+}', async (c) => {
  const u = c.get('user');
  const id = Number(c.req.param('id'));
  const camp = await c.env.DB.prepare(`${CAMPAIGN_SELECT} WHERE c.id = ?`)
    .bind(u?.id ?? 0, u?.id ?? 0, id)
    .first<{ visibility: string; start_date: string; end_date: string }>();
  if (!camp || !visibleSet(u).includes(camp.visibility)) fail(404, 'Campanha não encontrada.');
  const mine = u
    ? (await c.env.DB.prepare('SELECT day FROM campaign_checkins WHERE campaign_id = ? AND user_id = ? ORDER BY day').bind(id, u.id).all<{ day: string }>()).results.map((r) => r.day)
    : [];
  let participants: unknown[] = [];
  if (isLeader(u)) {
    participants = (
      await c.env.DB.prepare(
        `SELECT u.name, (SELECT COUNT(*) FROM campaign_checkins k WHERE k.campaign_id = m.campaign_id AND k.user_id = m.user_id) AS checkins
         FROM campaign_members m JOIN users u ON u.id = m.user_id WHERE m.campaign_id = ? ORDER BY checkins DESC, u.name`,
      )
        .bind(id)
        .all()
    ).results;
  }
  return c.json({
    campaign: { ...camp, days_total: daysBetween(camp.start_date, camp.end_date) },
    my_days: mine,
    participants,
    today: spParts(now()).ymd,
  });
});

function readCampaign(b: Record<string, unknown>) {
  const start = dateStr(b.start_date, 'início');
  const end = dateStr(b.end_date, 'fim');
  if (!start || !end) fail(400, 'Informe as datas de início e fim.');
  if (end < start) fail(400, 'A data de fim precisa ser depois do início.');
  if (daysBetween(start, end) > 366) fail(400, 'A campanha pode durar no máximo um ano.');
  return {
    title: reqStr(b.title, 120, 'o nome da campanha'),
    description: str(b.description, 4000, { label: 'descrição' }),
    daily_goal: str(b.daily_goal, 300, { label: 'propósito diário' }),
    start,
    end,
    visibility: oneOf(b.visibility ?? 'members', VIS, 'visibilidade'),
  };
}

communityRoutes.post('/campanhas', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const k = readCampaign(b);
  const cover = await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      'INSERT INTO campaigns (title, description, daily_goal, start_date, end_date, cover_id, visibility, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(k.title, k.description, k.daily_goal, k.start, k.end, cover, k.visibility, u.id, t, t),
  ];
  const cs = coverStmt(c.env, cover, k.visibility);
  if (cs) stmts.push(cs);
  const res = await c.env.DB.batch(stmts);
  const id = res[0].meta.last_row_id;
  if (bool(b.notify)) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'avisos',
      audience: k.visibility === 'public' ? 'all' : 'members',
      title: `Nova campanha: ${k.title}`,
      body: 'Toque para participar.',
      url: `/campanhas/${id}`,
      createdBy: u.id,
    });
  }
  return c.json({ id });
});

communityRoutes.put('/campanhas/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT cover_id FROM campaigns WHERE id = ?').bind(id).first<{ cover_id: string | null }>();
  if (!old) fail(404, 'Campanha não encontrada.');
  const b = await body(c);
  const k = readCampaign(b);
  const cover = b.cover_id === old.cover_id ? old.cover_id : await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const stmts = [
    c.env.DB.prepare(
      'UPDATE campaigns SET title = ?, description = ?, daily_goal = ?, start_date = ?, end_date = ?, cover_id = ?, visibility = ?, updated_at = ? WHERE id = ?',
    ).bind(k.title, k.description, k.daily_goal, k.start, k.end, cover, k.visibility, now(), id),
  ];
  const cs = coverStmt(c.env, cover, k.visibility);
  if (cs) stmts.push(cs);
  await c.env.DB.batch(stmts);
  if (old.cover_id && old.cover_id !== cover) await deleteMedia(c.env, [old.cover_id]);
  return c.json({ ok: true });
});

communityRoutes.delete('/campanhas/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT title, cover_id FROM campaigns WHERE id = ?').bind(id).first<{ title: string; cover_id: string | null }>();
  if (!old) fail(404, 'Campanha não encontrada.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM campaign_checkins WHERE campaign_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaign_members WHERE campaign_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM campaigns WHERE id = ?').bind(id),
    auditLog(c, u.id, 'campanha_excluida', old.title),
  ]);
  await deleteMedia(c.env, [old.cover_id]);
  return c.json({ ok: true });
});

async function visibleCampaign(c: Ctx, u: User, id: number) {
  const k = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<{ visibility: string; start_date: string; end_date: string }>();
  if (!k || !visibleSet(u).includes(k.visibility)) fail(404, 'Campanha não encontrada.');
  return k;
}

communityRoutes.post('/campanhas/:id{[0-9]+}/participar', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const k = await visibleCampaign(c, u, id);
  if (k.end_date < spParts(now()).ymd) fail(400, 'Esta campanha já terminou.');
  await c.env.DB.prepare('INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, u.id, now()).run();
  return c.json({ ok: true });
});

communityRoutes.post('/campanhas/:id{[0-9]+}/sair', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM campaign_members WHERE campaign_id = ? AND user_id = ?').bind(id, u.id),
    c.env.DB.prepare('DELETE FROM campaign_checkins WHERE campaign_id = ? AND user_id = ?').bind(id, u.id),
  ]);
  return c.json({ ok: true });
});

/** Marca (ou desmarca) o dia de hoje como cumprido. */
communityRoutes.post('/campanhas/:id{[0-9]+}/checkin', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const k = await visibleCampaign(c, u, id);
  const b = await body(c);
  const today = spParts(now()).ymd;
  const day = dateStr(b.day, 'dia') ?? today;
  if (day > today) fail(400, 'Não dá para marcar um dia que ainda não chegou.');
  if (day < k.start_date || day > k.end_date) fail(400, 'Este dia está fora do período da campanha.');
  if (day < addDays(today, -2)) fail(400, 'Só dá para marcar hoje e os dois dias anteriores.');
  const joined = await c.env.DB.prepare('SELECT 1 FROM campaign_members WHERE campaign_id = ? AND user_id = ?').bind(id, u.id).first();
  if (!joined) await c.env.DB.prepare('INSERT OR IGNORE INTO campaign_members (campaign_id, user_id, joined_at) VALUES (?, ?, ?)').bind(id, u.id, now()).run();
  const del = await c.env.DB.prepare('DELETE FROM campaign_checkins WHERE campaign_id = ? AND user_id = ? AND day = ?').bind(id, u.id, day).run();
  if (!del.meta.changes) {
    await c.env.DB.prepare('INSERT INTO campaign_checkins (campaign_id, user_id, day, created_at) VALUES (?, ?, ?, ?)').bind(id, u.id, day, now()).run();
    return c.json({ ok: true, done: true });
  }
  return c.json({ ok: true, done: false });
});

// =============== MINISTÉRIOS (Células, Casa de Paz, Rede Jovem, Missões) ===============

const MIN_TYPES = ['celula', 'casa_de_paz', 'ministerio', 'missoes'] as const;

communityRoutes.get('/ministerios', async (c) => {
  const u = c.get('user');
  const all = isLeader(u) && c.req.query('todos') === '1';
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM ministry_requests r WHERE r.ministry_id = m.id AND r.status = 'novo') AS new_requests,
       EXISTS (SELECT 1 FROM ministry_requests r WHERE r.ministry_id = m.id AND r.user_id = ?) AS requested
     FROM ministries m ${all ? '' : 'WHERE m.active = 1'} ORDER BY m.sort, m.name`,
  )
    .bind(u?.id ?? 0)
    .all<Record<string, unknown>>();
  const member = isMember(u);
  const leader = isLeader(u);
  return c.json({
    ministries: results.map((m) => ({
      ...m,
      address: member ? m.address : null,
      contact_phone: member ? m.contact_phone : null,
      new_requests: leader ? m.new_requests : 0,
    })),
  });
});

function readMinistry(b: Record<string, unknown>) {
  const ig = str(b.instagram, 60, { label: 'Instagram' })?.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/\/.*$/, '') ?? null;
  return {
    type: oneOf(b.type ?? 'ministerio', MIN_TYPES, 'tipo'),
    name: reqStr(b.name, 80, 'o nome'),
    description: str(b.description, 3000, { label: 'descrição' }),
    leader_name: str(b.leader_name, 120, { label: 'líder' }),
    schedule_note: str(b.schedule_note, 120, { label: 'dia e horário' }),
    neighborhood: str(b.neighborhood, 80, { label: 'bairro' }),
    address: str(b.address, 200, { label: 'endereço' }),
    contact_phone: str(b.contact_phone, 30, { label: 'telefone' }),
    instagram: ig,
    active: b.active === undefined ? 1 : bool(b.active) ? 1 : 0,
    sort: int(b.sort, 0, 1000, 'ordem') ?? 50,
  };
}

communityRoutes.post('/ministerios', async (c) => {
  const u = needLeader(c);
  const b = await body(c);
  const m = readMinistry(b);
  const cover = await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const t = now();
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO ministries (type, name, description, leader_name, schedule_note, neighborhood, address, contact_phone, instagram, cover_id, active, sort, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(m.type, m.name, m.description, m.leader_name, m.schedule_note, m.neighborhood, m.address, m.contact_phone, m.instagram, cover, m.active, m.sort, t, t),
  ];
  const cs = coverStmt(c.env, cover, 'public');
  if (cs) stmts.push(cs);
  const res = await c.env.DB.batch(stmts);
  return c.json({ id: res[0].meta.last_row_id });
});

communityRoutes.put('/ministerios/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT cover_id FROM ministries WHERE id = ?').bind(id).first<{ cover_id: string | null }>();
  if (!old) fail(404, 'Não encontrado.');
  const b = await body(c);
  const m = readMinistry(b);
  const cover = b.cover_id === old.cover_id ? old.cover_id : await optionalMedia(c.env, b.cover_id, u, ['cover']);
  const stmts = [
    c.env.DB.prepare(
      `UPDATE ministries SET type = ?, name = ?, description = ?, leader_name = ?, schedule_note = ?, neighborhood = ?, address = ?,
         contact_phone = ?, instagram = ?, cover_id = ?, active = ?, sort = ?, updated_at = ? WHERE id = ?`,
    ).bind(m.type, m.name, m.description, m.leader_name, m.schedule_note, m.neighborhood, m.address, m.contact_phone, m.instagram, cover, m.active, m.sort, now(), id),
  ];
  const cs = coverStmt(c.env, cover, 'public');
  if (cs) stmts.push(cs);
  await c.env.DB.batch(stmts);
  if (old.cover_id && old.cover_id !== cover) await deleteMedia(c.env, [old.cover_id]);
  return c.json({ ok: true });
});

communityRoutes.delete('/ministerios/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT name, cover_id FROM ministries WHERE id = ?').bind(id).first<{ name: string; cover_id: string | null }>();
  if (!old) fail(404, 'Não encontrado.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM ministry_requests WHERE ministry_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM ministries WHERE id = ?').bind(id),
    auditLog(c, u.id, 'ministerio_excluido', old.name),
  ]);
  await deleteMedia(c.env, [old.cover_id]);
  return c.json({ ok: true });
});

communityRoutes.post('/ministerios/:id{[0-9]+}/participar', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `min:${u.id}`, 20, 3600_000);
  const id = Number(c.req.param('id'));
  const m = await c.env.DB.prepare('SELECT name FROM ministries WHERE id = ? AND active = 1').bind(id).first<{ name: string }>();
  if (!m) fail(404, 'Não encontrado.');
  const b = await body(c);
  const res = await c.env.DB.prepare(
    "INSERT INTO ministry_requests (ministry_id, user_id, message, status, created_at) VALUES (?, ?, ?, 'novo', ?) ON CONFLICT(ministry_id, user_id) DO NOTHING",
  )
    .bind(id, u.id, str(b.message, 500, { label: 'mensagem' }), now())
    .run();
  if (res.meta.changes) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'admin',
      audience: 'leaders',
      title: `Quer participar: ${m.name}`,
      body: `${u.name}${u.phone ? ` · ${u.phone}` : ''}`,
      url: '/admin/pedidos',
      createdBy: u.id,
    });
  }
  return c.json({ ok: true });
});

communityRoutes.get('/ministerios/pedidos', async (c) => {
  needLeader(c);
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, m.name AS ministry_name, u.name AS user_name, u.phone, u.email, u.neighborhood
     FROM ministry_requests r JOIN ministries m ON m.id = r.ministry_id JOIN users u ON u.id = r.user_id
     ORDER BY r.status = 'novo' DESC, r.id DESC LIMIT 200`,
  ).all();
  return c.json({ requests: results });
});

communityRoutes.patch('/ministerios/pedidos/:id{[0-9]+}', async (c) => {
  needLeader(c);
  const b = await body(c);
  const status = oneOf(b.status, ['novo', 'contatado', 'arquivado'] as const, 'situação');
  await c.env.DB.prepare('UPDATE ministry_requests SET status = ? WHERE id = ?').bind(status, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

