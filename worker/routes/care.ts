/** Oração e cuidado: pedidos de oração, testemunhos, cartão do visitante e aniversariantes. */
import { Hono } from 'hono';
import type { AppEnv, Ctx } from '../types';
import {
  auditLog,
  body,
  bool,
  clientIp,
  fail,
  int,
  isLeader,
  isMember,
  needLeader,
  needMember,
  needUser,
  now,
  oneOf,
  originOf,
  rateLimit,
  reqStr,
  sha256Hex,
  spParts,
  str,
} from '../util';
import { deleteMedia, optionalMedia, useMediaStmt } from '../storage';
import { notifyNow } from '../push';

export const careRoutes = new Hono<AppEnv>();

const wait = (c: Ctx) => (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

// =============== PEDIDOS DE ORAÇÃO ===============

careRoutes.get('/oracao', async (c) => {
  const u = needUser(c);
  const filtro = c.req.query('filtro') ?? 'mural';
  const before = int(c.req.query('antes'), 1, 1e12, 'cursor');
  const conds: string[] = [];
  const binds: unknown[] = [u.id];
  if (filtro === 'meus') {
    conds.push('p.user_id = ?');
    binds.push(u.id);
  } else if (filtro === 'lideranca') {
    if (!isLeader(u)) fail(403, 'Só a liderança vê estes pedidos.');
    conds.push("p.visibility = 'lideranca'");
  } else {
    if (!isMember(u)) fail(403, 'Seu cadastro precisa ser aprovado para ver o mural de oração.');
    conds.push("p.visibility = 'igreja'", 'p.hidden = 0');
  }
  if (before) {
    conds.push('p.id < ?');
    binds.push(before);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, u.picture AS author_picture,
       EXISTS (SELECT 1 FROM prayer_marks m WHERE m.prayer_id = p.id AND m.user_id = ?) AS prayed
     FROM prayers p LEFT JOIN users u ON u.id = p.user_id
     WHERE ${conds.join(' AND ')} ORDER BY p.answered ASC, p.id DESC LIMIT 41`,
  )
    .bind(...binds)
    .all<Record<string, unknown> & { id: number; anonymous: number; user_id: number | null }>();
  const leader = isLeader(u);
  const items = results.slice(0, 40).map((p) => {
    const hideName = p.anonymous && !leader && p.user_id !== u.id;
    return {
      ...p,
      author_name: hideName ? null : p.author_name,
      author_picture: hideName ? null : p.author_picture,
      mine: p.user_id === u.id,
    };
  });
  return c.json({ prayers: items, next: results.length > 40 ? results[39].id : null });
});

careRoutes.post('/oracao', async (c) => {
  const u = needUser(c);
  await rateLimit(c.env, `ora:${u.id}`, 15, 3600_000);
  const b = await body(c);
  let visibility = oneOf(b.visibility ?? 'igreja', ['igreja', 'lideranca'] as const, 'visibilidade');
  if (!isMember(u)) visibility = 'lideranca';
  const anonymous = bool(b.anonymous) ? 1 : 0;
  const text = reqStr(b.body, 1500, 'o pedido de oração');
  const row = await c.env.DB.prepare(
    'INSERT INTO prayers (user_id, body, visibility, anonymous, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(u.id, text, visibility, anonymous, now())
    .first<{ id: number }>();
  const who = anonymous ? 'Pedido anônimo' : u.name;
  if (visibility === 'lideranca') {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'admin',
      audience: 'leaders',
      title: 'Novo pedido de oração para a liderança',
      body: `${u.name}: ${text.slice(0, 120)}`,
      url: '/oracao?filtro=lideranca',
      createdBy: u.id,
    });
  } else {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'oracao',
      audience: 'members',
      title: 'Novo pedido de oração',
      body: `${who}: ${text.slice(0, 120)}`,
      url: '/oracao',
      createdBy: u.id,
    });
  }
  return c.json({ id: row!.id });
});

careRoutes.post('/oracao/:id{[0-9]+}/orei', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT visibility, user_id FROM prayers WHERE id = ? AND hidden = 0')
    .bind(id)
    .first<{ visibility: string; user_id: number | null }>();
  if (!p || (p.visibility === 'lideranca' && !isLeader(u) && p.user_id !== u.id)) fail(404, 'Pedido não encontrado.');
  const ins = await c.env.DB.prepare('INSERT OR IGNORE INTO prayer_marks (prayer_id, user_id, created_at) VALUES (?, ?, ?)')
    .bind(id, u.id, now())
    .run();
  if (ins.meta.changes) await c.env.DB.prepare('UPDATE prayers SET pray_count = pray_count + 1 WHERE id = ?').bind(id).run();
  const r = await c.env.DB.prepare('SELECT pray_count FROM prayers WHERE id = ?').bind(id).first<{ pray_count: number }>();
  return c.json({ ok: true, pray_count: r?.pray_count ?? 0 });
});

careRoutes.post('/oracao/:id{[0-9]+}/respondida', async (c) => {
  const u = needUser(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  const r = await c.env.DB.prepare('UPDATE prayers SET answered = 1, answered_note = ?, answered_at = ? WHERE id = ? AND user_id = ?')
    .bind(str(b.note, 1000, { label: 'como Deus respondeu' }), now(), id, u.id)
    .run();
  if (!r.meta.changes) fail(404, 'Pedido não encontrado.');
  return c.json({ ok: true });
});

careRoutes.patch('/oracao/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE prayers SET hidden = ? WHERE id = ?').bind(bool(b.hidden) ? 1 : 0, id),
    auditLog(c, u.id, bool(b.hidden) ? 'oracao_ocultada' : 'oracao_reexibida', `pedido ${id}`),
  ]);
  return c.json({ ok: true });
});

careRoutes.delete('/oracao/:id{[0-9]+}', async (c) => {
  const u = needUser(c);
  const id = Number(c.req.param('id'));
  const p = await c.env.DB.prepare('SELECT user_id FROM prayers WHERE id = ?').bind(id).first<{ user_id: number | null }>();
  if (!p) fail(404, 'Pedido não encontrado.');
  if (p.user_id !== u.id && !isLeader(u)) fail(403, 'Só quem fez o pedido (ou a liderança) pode apagar.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM prayer_marks WHERE prayer_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM prayers WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// =============== TESTEMUNHOS ===============

careRoutes.get('/testemunhos', async (c) => {
  const u = needMember(c);
  const status = c.req.query('status');
  const conds: string[] = [];
  const binds: unknown[] = [u.id];
  if (status === 'pendente') {
    if (!isLeader(u)) fail(403, 'Só a liderança vê os testemunhos em análise.');
    conds.push("t.status = 'pendente'");
  } else if (status === 'meus') {
    conds.push('t.user_id = ?');
    binds.push(u.id);
  } else {
    conds.push("t.status = 'aprovado'");
  }
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, u.name AS author_name, u.picture AS author_picture,
       EXISTS (SELECT 1 FROM testimony_amens a WHERE a.testimony_id = t.id AND a.user_id = ?) AS amen
     FROM testimonies t LEFT JOIN users u ON u.id = t.user_id
     WHERE ${conds.join(' AND ')} ORDER BY t.id DESC LIMIT 60`,
  )
    .bind(...binds)
    .all();
  return c.json({ testimonies: results });
});

careRoutes.post('/testemunhos', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `test:${u.id}`, 10, 3600_000);
  const b = await body(c);
  const image = await optionalMedia(c.env, b.image_id, u, ['cover', 'photo']);
  const stmts = [
    c.env.DB.prepare('INSERT INTO testimonies (user_id, title, body, image_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(
      u.id,
      str(b.title, 120, { label: 'título' }),
      reqStr(b.body, 5000, 'o testemunho'),
      image,
      now(),
    ),
  ];
  const used = useMediaStmt(c.env, [image]);
  if (used) stmts.push(used);
  const res = await c.env.DB.batch(stmts);
  await notifyNow(c.env, originOf(c), wait(c), {
    topic: 'admin',
    audience: 'leaders',
    title: 'Novo testemunho para revisar',
    body: `${u.name} enviou um testemunho.`,
    url: '/testemunhos?status=pendente',
    createdBy: u.id,
  });
  return c.json({ id: res[0].meta.last_row_id });
});

careRoutes.post('/testemunhos/:id{[0-9]+}/revisar', async (c) => {
  const u = needLeader(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  const status = oneOf(b.status, ['aprovado', 'recusado'] as const, 'decisão');
  const t = await c.env.DB.prepare('SELECT user_id, title FROM testimonies WHERE id = ?').bind(id).first<{ user_id: number | null; title: string | null }>();
  if (!t) fail(404, 'Testemunho não encontrado.');
  await c.env.DB.prepare('UPDATE testimonies SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').bind(status, u.id, now(), id).run();
  if (status === 'aprovado' && t.user_id) {
    await notifyNow(c.env, originOf(c), wait(c), {
      topic: 'pessoal',
      audience: `user:${t.user_id}`,
      title: 'Seu testemunho foi publicado',
      body: 'Obrigado por compartilhar o que Deus fez!',
      url: '/testemunhos',
      createdBy: u.id,
    });
  }
  return c.json({ ok: true });
});

careRoutes.post('/testemunhos/:id{[0-9]+}/amem', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const ins = await c.env.DB.prepare(
    "INSERT OR IGNORE INTO testimony_amens (testimony_id, user_id) SELECT id, ? FROM testimonies WHERE id = ? AND status = 'aprovado'",
  )
    .bind(u.id, id)
    .run();
  if (ins.meta.changes) await c.env.DB.prepare('UPDATE testimonies SET amen_count = amen_count + 1 WHERE id = ?').bind(id).run();
  const r = await c.env.DB.prepare('SELECT amen_count FROM testimonies WHERE id = ?').bind(id).first<{ amen_count: number }>();
  return c.json({ ok: true, amen_count: r?.amen_count ?? 0 });
});

careRoutes.delete('/testemunhos/:id{[0-9]+}', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const t = await c.env.DB.prepare('SELECT user_id, image_id FROM testimonies WHERE id = ?').bind(id).first<{ user_id: number | null; image_id: string | null }>();
  if (!t) fail(404, 'Testemunho não encontrado.');
  if (t.user_id !== u.id && !isLeader(u)) fail(403, 'Só quem enviou (ou a liderança) pode apagar.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM testimony_amens WHERE testimony_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM testimonies WHERE id = ?').bind(id),
  ]);
  await deleteMedia(c.env, [t.image_id]);
  return c.json({ ok: true });
});

// =============== CARTÃO DO VISITANTE (público) ===============

careRoutes.post('/visitantes', async (c) => {
  const ipKey = await sha256Hex(`visit:${clientIp(c)}`);
  await rateLimit(c.env, `vis:${ipKey.slice(0, 24)}`, 5, 3600_000);
  const b = await body(c);
  if (typeof b.website === 'string' && b.website) return c.json({ ok: true }); // armadilha para robôs
  const phone = str(b.phone, 30, { label: 'telefone' });
  if (phone && !/^[\d\s()+-]{8,30}$/.test(phone)) fail(400, 'Telefone inválido.');
  const wantsContact = bool(b.wants_contact);
  if ((phone || wantsContact) && !bool(b.consent))
    fail(400, 'Para guardarmos seu telefone, marque a autorização de contato.');
  const name = reqStr(b.name, 120, 'seu nome');
  await c.env.DB.prepare(
    'INSERT INTO visitors (name, phone, neighborhood, first_time, how_found, prayer, wants_contact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      name,
      phone,
      str(b.neighborhood, 80, { label: 'bairro' }),
      b.first_time === undefined ? null : bool(b.first_time) ? 1 : 0,
      str(b.how_found, 200, { label: 'como conheceu' }),
      str(b.prayer, 1500, { label: 'pedido de oração' }),
      wantsContact ? 1 : 0,
      now(),
    )
    .run();
  await notifyNow(c.env, originOf(c), wait(c), {
    topic: 'admin',
    audience: 'leaders',
    title: 'Novo cartão de visitante',
    body: `${name}${bool(b.first_time) ? ' (primeira vez)' : ''}`,
    url: '/admin/visitantes',
  });
  return c.json({ ok: true });
});

careRoutes.get('/visitantes', async (c) => {
  needLeader(c);
  const { results } = await c.env.DB.prepare("SELECT * FROM visitors ORDER BY status = 'novo' DESC, id DESC LIMIT 300").all();
  return c.json({ visitors: results });
});

careRoutes.patch('/visitantes/:id{[0-9]+}', async (c) => {
  needLeader(c);
  const b = await body(c);
  await c.env.DB.prepare('UPDATE visitors SET status = ?, notes = ? WHERE id = ?')
    .bind(
      oneOf(b.status, ['novo', 'contatado', 'membro', 'arquivado'] as const, 'situação'),
      str(b.notes, 1000, { label: 'observações' }),
      Number(c.req.param('id')),
    )
    .run();
  return c.json({ ok: true });
});

careRoutes.delete('/visitantes/:id{[0-9]+}', async (c) => {
  const u = needLeader(c);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM visitors WHERE id = ?').bind(Number(c.req.param('id'))),
    auditLog(c, u.id, 'visitante_excluido', c.req.param('id')),
  ]);
  return c.json({ ok: true });
});

// =============== ANIVERSARIANTES (para os membros) ===============

careRoutes.get('/aniversariantes', async (c) => {
  needMember(c);
  const p = spParts(now());
  const month = int(c.req.query('mes'), 1, 12, 'mês') ?? p.month;
  const mm = String(month).padStart(2, '0');
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, picture, substr(birthday, 9, 2) AS day FROM users
     WHERE status = 'aprovado' AND show_birthday = 1 AND birthday IS NOT NULL AND substr(birthday, 6, 2) = ?
     ORDER BY day, name`,
  )
    .bind(mm)
    .all<{ day: string }>();
  return c.json({ month, today: p.month === month ? String(p.day).padStart(2, '0') : null, people: results });
});
