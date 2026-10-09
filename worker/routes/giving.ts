/** Dízimos e ofertas: dados para contribuir (PIX e banco) e registro das contribuições. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { auditLog, body, dateStr, fail, int, isMember, needAdmin, needMember, now, oneOf, originOf, rateLimit, spParts, str } from '../util';
import { deleteMedia, optionalMedia, useMediaStmt } from '../storage';
import { getSetting } from '../settings';
import { notifyNow } from '../push';

export const givingRoutes = new Hono<AppEnv>();

const METHODS = ['pix', 'transferencia', 'dinheiro', 'cartao', 'boleto'] as const;
const STATUSES = ['informado', 'conferido', 'recusado'] as const;

/** Aceita "150", "150,50", "1.250,00", "R$ 80" ou centavos (número inteiro). */
export function parseAmount(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 100_000_000) return v;
  if (typeof v !== 'string') fail(400, 'Informe o valor.');
  const clean = v.replace(/R\$|\s/g, '');
  if (!/^\d{1,3}(\.?\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(clean)) fail(400, 'Valor inválido. Exemplo: 150,00');
  let normalized: string;
  if (clean.includes(',')) normalized = clean.replace(/\./g, '').replace(',', '.');
  else if (/^\d+\.\d{1,2}$/.test(clean)) normalized = clean;
  else normalized = clean.replace(/\./g, '');
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isFinite(cents) || cents <= 0 || cents > 100_000_000) fail(400, 'Valor inválido.');
  return cents;
}

givingRoutes.get('/dizimos', async (c) => {
  const u = c.get('user');
  const g = await getSetting(c.env, 'giving');
  if (g.visible_to !== 'public' && !isMember(u)) {
    return c.json({ restricted: true, configured: !!(g.pix_key || g.account) });
  }
  return c.json({
    restricted: false,
    configured: !!(g.pix_key || g.account),
    holder_title: g.holder_title,
    holder_name: g.holder_name,
    pix_key_type: g.pix_key_type,
    pix_key: g.pix_key,
    pix_name: g.pix_name,
    pix_city: g.pix_city,
    bank_name: g.bank_name,
    bank_code: g.bank_code,
    agency: g.agency,
    account: g.account,
    account_type: g.account_type,
    holder_doc: g.holder_doc,
    message: g.message,
    types: g.types,
  });
});

givingRoutes.get('/contribuicoes/minhas', async (c) => {
  const u = needMember(c);
  const year = int(c.req.query('ano'), 2000, 2100, 'ano') ?? spParts(now()).year;
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM contributions WHERE user_id = ? AND substr(given_on, 1, 4) = ? ORDER BY given_on DESC, id DESC",
  )
    .bind(u.id, String(year))
    .all<{ amount_cents: number; status: string; type: string }>();
  const total = results.filter((r) => r.status !== 'recusado').reduce((s, r) => s + r.amount_cents, 0);
  return c.json({ year, contributions: results, total_cents: total });
});

givingRoutes.post('/contribuicoes', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `contrib:${u.id}`, 30, 3600_000);
  const b = await body(c);
  const g = await getSetting(c.env, 'giving');
  const type = str(b.type, 40, { required: true, label: 'o tipo' })!;
  if (!g.types.includes(type) && type !== 'Outro') fail(400, 'Tipo de contribuição inválido.');
  const amount = parseAmount(b.amount);
  const givenOn = dateStr(b.given_on, 'data') ?? spParts(now()).ymd;
  if (givenOn > spParts(now() + 86400000).ymd) fail(400, 'A data não pode ser no futuro.');
  const receipt = await optionalMedia(c.env, b.receipt_id, u, ['receipt']);
  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO contributions (user_id, donor_name, type, amount_cents, method, given_on, receipt_id, note, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'informado', ?, ?)`,
    ).bind(u.id, u.name, type, amount, oneOf(b.method ?? 'pix', METHODS, 'forma de pagamento'), givenOn, receipt, str(b.note, 300, { label: 'observação' }), u.id, now()),
  ];
  const used = useMediaStmt(c.env, [receipt]);
  if (used) stmts.push(used);
  const res = await c.env.DB.batch(stmts);
  await notifyNow(c.env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
    topic: 'admin',
    audience: 'admins',
    title: 'Nova contribuição informada',
    body: `${u.name} informou ${type.toLowerCase()} de R$ ${(amount / 100).toFixed(2).replace('.', ',')}.`,
    url: '/admin/contribuicoes',
    createdBy: u.id,
  });
  return c.json({ id: res[0].meta.last_row_id });
});

givingRoutes.delete('/contribuicoes/:id{[0-9]+}', async (c) => {
  const u = needMember(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT user_id, status, receipt_id FROM contributions WHERE id = ?')
    .bind(id)
    .first<{ user_id: number | null; status: string; receipt_id: string | null }>();
  if (!row || row.user_id !== u.id) fail(404, 'Registro não encontrado.');
  if (row.status !== 'informado') fail(400, 'Este registro já foi conferido pela tesouraria e não pode ser apagado.');
  await c.env.DB.prepare('DELETE FROM contributions WHERE id = ?').bind(id).run();
  await deleteMedia(c.env, [row.receipt_id]);
  return c.json({ ok: true });
});

// =============== ADMINISTRAÇÃO ===============

givingRoutes.get('/admin/contribuicoes', async (c) => {
  needAdmin(c);
  const month = c.req.query('mes');
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    conds.push('substr(c.given_on, 1, 7) = ?');
    binds.push(month);
  }
  const status = c.req.query('status');
  if (status && (STATUSES as readonly string[]).includes(status)) {
    conds.push('c.status = ?');
    binds.push(status);
  }
  const type = c.req.query('tipo');
  if (type) {
    conds.push('c.type = ?');
    binds.push(type.slice(0, 40));
  }
  const q = c.req.query('q');
  if (q) {
    conds.push('(c.donor_name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
    binds.push(`%${q.slice(0, 60)}%`, `%${q.slice(0, 60)}%`, `%${q.slice(0, 60)}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, COALESCE(u.name, c.donor_name) AS person, u.email FROM contributions c LEFT JOIN users u ON u.id = c.user_id
     ${where} ORDER BY c.given_on DESC, c.id DESC LIMIT 500`,
  )
    .bind(...binds)
    .all<{ amount_cents: number; status: string; type: string }>();
  const ok = results.filter((r) => r.status !== 'recusado');
  const byType: Record<string, number> = {};
  for (const r of ok) byType[r.type] = (byType[r.type] ?? 0) + r.amount_cents;
  return c.json({
    contributions: results,
    total_cents: ok.reduce((s, r) => s + r.amount_cents, 0),
    by_type: byType,
    pending: results.filter((r) => r.status === 'informado').length,
  });
});

givingRoutes.get('/admin/contribuicoes/resumo', async (c) => {
  needAdmin(c);
  const year = int(c.req.query('ano'), 2000, 2100, 'ano') ?? spParts(now()).year;
  const { results } = await c.env.DB.prepare(
    `SELECT substr(given_on, 1, 7) AS month, type, SUM(amount_cents) AS total, COUNT(*) AS n, COUNT(DISTINCT user_id) AS people
     FROM contributions WHERE status != 'recusado' AND substr(given_on, 1, 4) = ? GROUP BY month, type ORDER BY month`,
  )
    .bind(String(year))
    .all();
  const tithers = await c.env.DB.prepare(
    `SELECT substr(given_on, 1, 7) AS month, COUNT(DISTINCT COALESCE(user_id, donor_name)) AS n FROM contributions
     WHERE status != 'recusado' AND type = 'Dízimo' AND substr(given_on, 1, 4) = ? GROUP BY month`,
  )
    .bind(String(year))
    .all();
  return c.json({ year, rows: results, tithers: tithers.results });
});

givingRoutes.post('/admin/contribuicoes', async (c) => {
  const u = needAdmin(c);
  const b = await body(c);
  const userId = int(b.user_id, 1, 1e9, 'membro');
  let donor = str(b.donor_name, 120, { label: 'nome' });
  if (userId) {
    const m = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string }>();
    if (!m) fail(404, 'Membro não encontrado.');
    donor = m.name;
  }
  if (!donor) fail(400, 'Escolha o membro ou digite o nome de quem contribuiu (pode ser "Anônimo").');
  const row = await c.env.DB.prepare(
    `INSERT INTO contributions (user_id, donor_name, type, amount_cents, method, given_on, note, status, created_by, created_at, reviewed_by, reviewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'conferido', ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      userId,
      donor,
      str(b.type, 40, { required: true, label: 'o tipo' }),
      parseAmount(b.amount),
      oneOf(b.method ?? 'dinheiro', METHODS, 'forma de pagamento'),
      dateStr(b.given_on, 'data') ?? spParts(now()).ymd,
      str(b.note, 300, { label: 'observação' }),
      u.id,
      now(),
      u.id,
      now(),
    )
    .first<{ id: number }>();
  return c.json({ id: row!.id });
});

givingRoutes.patch('/admin/contribuicoes/:id{[0-9]+}', async (c) => {
  const u = needAdmin(c);
  const id = Number(c.req.param('id'));
  const b = await body(c);
  const old = await c.env.DB.prepare('SELECT * FROM contributions WHERE id = ?').bind(id).first<{ amount_cents: number; status: string }>();
  if (!old) fail(404, 'Registro não encontrado.');
  const status = b.status === undefined ? old.status : oneOf(b.status, STATUSES, 'situação');
  const amount = b.amount === undefined ? old.amount_cents : parseAmount(b.amount);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE contributions SET status = ?, amount_cents = ?, type = COALESCE(?, type), given_on = COALESCE(?, given_on),
         note = COALESCE(?, note), reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
    ).bind(status, amount, str(b.type, 40), dateStr(b.given_on, 'data'), str(b.note, 300), u.id, now(), id),
    auditLog(c, u.id, 'contribuicao_alterada', `#${id}: ${old.status}→${status}, ${old.amount_cents}→${amount}`),
  ]);
  return c.json({ ok: true });
});

givingRoutes.delete('/admin/contribuicoes/:id{[0-9]+}', async (c) => {
  const u = needAdmin(c);
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM contributions WHERE id = ?').bind(id).first<{ receipt_id: string | null; amount_cents: number; donor_name: string }>();
  if (!row) fail(404, 'Registro não encontrado.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM contributions WHERE id = ?').bind(id),
    auditLog(c, u.id, 'contribuicao_excluida', `#${id} ${row.donor_name} ${row.amount_cents}`),
  ]);
  await deleteMedia(c.env, [row.receipt_id]);
  return c.json({ ok: true });
});

givingRoutes.get('/admin/contribuicoes.csv', async (c) => {
  const u = needAdmin(c);
  const year = int(c.req.query('ano'), 2000, 2100, 'ano') ?? spParts(now()).year;
  const { results } = await c.env.DB.prepare(
    `SELECT c.given_on, COALESCE(u.name, c.donor_name) AS person, u.email, c.type, c.amount_cents, c.method, c.status, c.note
     FROM contributions c LEFT JOIN users u ON u.id = c.user_id WHERE substr(c.given_on, 1, 4) = ? ORDER BY c.given_on, c.id`,
  )
    .bind(String(year))
    .all<Record<string, unknown>>();
  await auditLog(c, u.id, 'exportou_contribuicoes', String(year)).run();
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = ['Data;Pessoa;E-mail;Tipo;Valor;Forma;Situação;Observação'];
  for (const r of results) {
    lines.push(
      [r.given_on, r.person, r.email, r.type, (Number(r.amount_cents) / 100).toFixed(2).replace('.', ','), r.method, r.status, r.note]
        .map(esc)
        .join(';'),
    );
  }
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="contribuicoes-${year}.csv"`,
      'cache-control': 'no-store',
    },
  });
});
