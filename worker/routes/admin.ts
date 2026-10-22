/** Administração: membros, aprovações, papéis, configurações, notificações, relatórios e histórico. */
import { Hono } from 'hono';
import type { AppEnv, User } from '../types';
import {
  auditLog,
  body,
  bool,
  dateStr,
  fail,
  hhmm,
  httpsUrl,
  int,
  needAdmin,
  needLeader,
  now,
  oneOf,
  originOf,
  reqStr,
  spParts,
  str,
} from '../util';
import { deleteUserCascade, meView } from '../auth';
import { notifyNow } from '../push';
import { DEFAULT_CHURCH, getSettings, setSetting, type ScheduleItem } from '../settings';
import { claimMedia, storageMode } from '../storage';

export const adminRoutes = new Hono<AppEnv>();

const ROLES = ['membro', 'midia', 'lider', 'admin'] as const;
const STATUSES = ['pendente', 'aprovado', 'bloqueado'] as const;

// ---------- painel ----------

adminRoutes.get('/resumo', async (c) => {
  const u = needLeader(c);
  const q = (sql: string, ...b: unknown[]) => c.env.DB.prepare(sql).bind(...b);
  const since30 = now() - 30 * 86400000;
  const res = await c.env.DB.batch([
    q("SELECT COUNT(*) AS n FROM users WHERE status = 'pendente'"),
    q("SELECT COUNT(*) AS n FROM users WHERE status = 'aprovado'"),
    q('SELECT COUNT(*) AS n FROM users WHERE last_seen_at > ?', since30),
    q("SELECT COUNT(*) AS n FROM visitors WHERE status = 'novo'"),
    q("SELECT COUNT(*) AS n FROM testimonies WHERE status = 'pendente'"),
    q("SELECT COUNT(*) AS n FROM prayers WHERE visibility = 'lideranca' AND created_at > ?", now() - 7 * 86400000),
    q("SELECT COUNT(*) AS n FROM ministry_requests WHERE status = 'novo'"),
    q("SELECT COUNT(*) AS n FROM contributions WHERE status = 'informado'"),
    q('SELECT COUNT(*) AS n FROM photos'),
    q("SELECT COUNT(*) AS n FROM videos WHERE hidden = 0 AND source != 'drive'"),
    q('SELECT COUNT(*) AS n FROM push_subs'),
    q('SELECT COALESCE(SUM(size), 0) AS n FROM media'),
  ]);
  const n = (i: number) => ((res[i].results[0] as { n: number } | undefined)?.n ?? 0);
  return c.json({
    pending_users: n(0),
    members: n(1),
    active_30d: n(2),
    new_visitors: n(3),
    pending_testimonies: n(4),
    leadership_prayers_7d: n(5),
    ministry_requests: n(6),
    pending_contributions: u.role === 'admin' ? n(7) : null,
    photos: n(8),
    videos: n(9),
    push_devices: n(10),
    storage_bytes: n(11),
    storage_mode: storageMode(c.env),
  });
});

// ---------- membros ----------

adminRoutes.get('/membros', async (c) => {
  needLeader(c);
  const conds: string[] = [];
  const binds: unknown[] = [];
  const status = c.req.query('status');
  if (status && (STATUSES as readonly string[]).includes(status)) {
    conds.push('status = ?');
    binds.push(status);
  }
  const role = c.req.query('papel');
  if (role && (ROLES as readonly string[]).includes(role)) {
    conds.push('role = ?');
    binds.push(role);
  }
  const q = c.req.query('q');
  if (q) {
    conds.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR neighborhood LIKE ?)');
    const like = `%${q.slice(0, 60)}%`;
    binds.push(like, like, like, like);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM users ${where} ORDER BY status = 'pendente' DESC, name COLLATE NOCASE LIMIT 1000`,
  )
    .bind(...binds)
    .all<User>();
  return c.json({ users: results.map((u) => ({ ...meView(u), notes: u.notes, last_seen_at: u.last_seen_at, approved_at: u.approved_at })) });
});

adminRoutes.patch('/membros/:id{[0-9]+}', async (c) => {
  const me = needAdmin(c);
  const id = Number(c.req.param('id'));
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!target) fail(404, 'Pessoa não encontrada.');
  const b = await body(c);
  const status = b.status === undefined ? target.status : oneOf(b.status, STATUSES, 'situação');
  const role = b.role === undefined ? target.role : oneOf(b.role, ROLES, 'papel');
  if (id === me.id && (status !== 'aprovado' || role !== 'admin'))
    fail(400, 'Você não pode tirar o seu próprio acesso de administrador. Peça a outro administrador.');
  if (target.role === 'admin' && (role !== 'admin' || status !== 'aprovado')) {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'aprovado'").first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) fail(400, 'Este é o único administrador. Nomeie outro antes de mudar este.');
  }
  const phone = b.phone === undefined ? target.phone : str(b.phone, 30, { label: 'telefone' });
  const t = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET status = ?, role = ?, name = ?, phone = ?, birthday = ?, neighborhood = ?, baptized = ?, member_since = ?, notes = ?,
         approved_at = CASE WHEN ? = 'aprovado' AND approved_at IS NULL THEN ? ELSE approved_at END,
         approved_by = CASE WHEN ? = 'aprovado' AND approved_by IS NULL THEN ? ELSE approved_by END
       WHERE id = ?`,
    ).bind(
      status,
      role,
      b.name === undefined ? target.name : reqStr(b.name, 120, 'o nome'),
      phone,
      b.birthday === undefined ? target.birthday : dateStr(b.birthday, 'aniversário'),
      b.neighborhood === undefined ? target.neighborhood : str(b.neighborhood, 80, { label: 'bairro' }),
      b.baptized === undefined ? target.baptized : b.baptized === null || b.baptized === '' ? null : bool(b.baptized) ? 1 : 0,
      b.member_since === undefined ? target.member_since : str(b.member_since, 20, { label: 'membro desde' }),
      b.notes === undefined ? target.notes : str(b.notes, 2000, { label: 'observações' }),
      status,
      t,
      status,
      me.id,
      id,
    ),
    auditLog(c, me.id, 'membro_alterado', `${target.email}: ${target.status}/${target.role} → ${status}/${role}`),
    ...(status === 'bloqueado' ? [c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id)] : []),
  ]);
  if (status === 'aprovado' && target.status !== 'aprovado') {
    await notifyNow(c.env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
      topic: 'pessoal',
      audience: `user:${id}`,
      title: 'Seu acesso foi aprovado!',
      body: 'Bem-vindo(a) ao app da IRN. Toque para abrir.',
      url: '/',
      createdBy: me.id,
    });
  }
  return c.json({ ok: true });
});

adminRoutes.delete('/membros/:id{[0-9]+}', async (c) => {
  const me = needAdmin(c);
  const id = Number(c.req.param('id'));
  if (id === me.id) fail(400, 'Para excluir a sua própria conta, use o seu perfil.');
  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>();
  if (!target) fail(404, 'Pessoa não encontrada.');
  if (target.role === 'admin') fail(400, 'Tire o papel de administrador antes de excluir esta pessoa.');
  await deleteUserCascade(c.env, id, target.name);
  await auditLog(c, me.id, 'membro_excluido', target.email).run();
  return c.json({ ok: true });
});

adminRoutes.get('/aniversariantes', async (c) => {
  needLeader(c);
  const month = int(c.req.query('mes'), 1, 12, 'mês') ?? spParts(now()).month;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, phone, birthday, picture FROM users WHERE status = 'aprovado' AND birthday IS NOT NULL
     AND substr(birthday, 6, 2) = ? ORDER BY substr(birthday, 9, 2), name`,
  )
    .bind(String(month).padStart(2, '0'))
    .all();
  return c.json({ month, people: results });
});

adminRoutes.get('/membros.csv', async (c) => {
  const me = needAdmin(c);
  const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all<User>();
  await auditLog(c, me.id, 'exportou_membros', `${results.length} pessoas`).run();
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = ['Nome;E-mail;Telefone;Aniversário;Bairro;Batizado;Membro desde;Papel;Situação;Cadastro'];
  for (const u of results) {
    lines.push(
      [
        u.name,
        u.email,
        u.phone,
        u.birthday,
        u.neighborhood,
        u.baptized === null ? '' : u.baptized ? 'Sim' : 'Não',
        u.member_since,
        u.role,
        u.status,
        new Date(u.created_at).toISOString().slice(0, 10),
      ]
        .map(esc)
        .join(';'),
    );
  }
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="membros-irn.csv"',
      'cache-control': 'no-store',
    },
  });
});

// ---------- configurações ----------

adminRoutes.get('/config', async (c) => {
  needAdmin(c);
  const s = await getSettings(c.env, ['church', 'schedule', 'giving', 'youtube', 'reminders']);
  return c.json({ ...s, storage_mode: storageMode(c.env), video_upload: !!c.env.BUCKET });
});

adminRoutes.put('/config/:key', async (c) => {
  const me = needAdmin(c);
  const key = oneOf(c.req.param('key'), ['church', 'schedule', 'giving', 'youtube', 'reminders'] as const, 'configuração');
  const b = await body(c);
  let value: unknown;
  if (key === 'church') {
    const current = (await getSettings(c.env, ['church'])).church;
    const next: Record<string, unknown> = { ...current };
    for (const k of Object.keys(DEFAULT_CHURCH) as (keyof typeof DEFAULT_CHURCH)[]) {
      if (k.endsWith('_id')) continue;
      if (b[k] === undefined) continue;
      const max = k === 'about' ? 6000 : 200;
      next[k] = str(b[k], max, { label: k }) ?? '';
    }
    if (next.maps_url) next.maps_url = httpsUrl(next.maps_url, 'link do mapa') ?? '';
    if (next.youtube_url) next.youtube_url = httpsUrl(next.youtube_url, 'link do YouTube') ?? '';
    if (next.whatsapp) next.whatsapp = String(next.whatsapp).replace(/\D/g, '');
    if (next.youtube_channel_id && !/^UC[A-Za-z0-9_-]{22}$/.test(String(next.youtube_channel_id)))
      fail(400, 'ID do canal do YouTube inválido. Ele começa com UC e tem 24 caracteres.');
    for (const ig of ['instagram', 'instagram_youth', 'instagram_missions'])
      if (typeof next[ig] === 'string') next[ig] = String(next[ig]).replace(/^@/, '');
    if (!next.name) fail(400, 'O nome da igreja não pode ficar vazio.');
    // Logo e ícones (enviados como imagens pelo app)
    for (const k of ['logo_id', 'icon192_id', 'icon512_id', 'maskable_id'] as const) {
      if (b[k] === undefined) continue;
      if (b[k] === '' || b[k] === null) next[k] = '';
      else next[k] = (await claimMedia(c.env, b[k], me, ['logo', 'icon'])).id;
    }
    value = next;
  } else if (key === 'schedule') {
    const items = Array.isArray(b.items) ? b.items : fail(400, 'Lista de horários inválida.');
    if (items.length > 20) fail(400, 'No máximo 20 horários.');
    value = items.map((raw, i): ScheduleItem => {
      const it = (raw ?? {}) as Record<string, unknown>;
      return {
        id: str(it.id, 20) ?? `h${i}`,
        weekday: int(it.weekday, 0, 6, 'dia da semana') ?? fail(400, 'Escolha o dia da semana.'),
        time: hhmm(it.time) ?? fail(400, 'Informe o horário.'),
        title: reqStr(it.title, 60, 'o nome do culto'),
        note: str(it.note, 120) ?? '',
      };
    });
  } else if (key === 'giving') {
    const keyType = oneOf(b.pix_key_type ?? '', ['', 'cpf', 'cnpj', 'telefone', 'email', 'aleatoria'] as const, 'tipo de chave');
    let pixKey = str(b.pix_key, 77, { label: 'chave PIX' }) ?? '';
    if (pixKey) {
      if (keyType === 'cpf') pixKey = pixKey.replace(/\D/g, '');
      if (keyType === 'cnpj') pixKey = pixKey.replace(/\D/g, '');
      if (keyType === 'telefone') {
        const digits = pixKey.replace(/\D/g, '');
        pixKey = `+${digits.startsWith('55') ? digits : `55${digits}`}`;
      }
      if (keyType === 'email') pixKey = pixKey.toLowerCase();
      if (keyType === 'cpf' && pixKey.length !== 11) fail(400, 'CPF deve ter 11 números.');
      if (keyType === 'cnpj' && pixKey.length !== 14) fail(400, 'CNPJ deve ter 14 números.');
      if (keyType === 'telefone' && !/^\+55\d{10,11}$/.test(pixKey)) fail(400, 'Telefone da chave PIX inválido. Use DDD + número.');
      if (keyType === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pixKey)) fail(400, 'E-mail da chave PIX inválido.');
      if (keyType === 'aleatoria' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pixKey))
        fail(400, 'Chave aleatória inválida. Ela tem o formato 123e4567-e89b-12d3-a456-426614174000.');
      if (!keyType) fail(400, 'Escolha o tipo da chave PIX.');
    }
    const plain = (v: unknown, max: number, label: string) =>
      (str(v, max, { label }) ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toUpperCase()
        .replace(/[^A-Z0-9 .-]/g, '')
        .slice(0, max);
    const types = Array.isArray(b.types)
      ? (b.types as unknown[]).map((t) => str(t, 40)).filter((t): t is string => !!t).slice(0, 12)
      : ['Dízimo', 'Oferta'];
    value = {
      visible_to: b.visible_to === 'public' ? 'public' : 'members',
      holder_title: str(b.holder_title, 40) ?? '',
      holder_name: str(b.holder_name, 120) ?? '',
      pix_key_type: pixKey ? keyType : '',
      pix_key: pixKey,
      pix_name: plain(b.pix_name, 25, 'nome do recebedor') || 'IGREJA',
      pix_city: plain(b.pix_city, 15, 'cidade') || 'SAO PAULO',
      bank_name: str(b.bank_name, 80) ?? '',
      bank_code: str(b.bank_code, 10) ?? '',
      agency: str(b.agency, 20) ?? '',
      account: str(b.account, 30) ?? '',
      account_type: oneOf(b.account_type ?? 'corrente', ['corrente', 'poupanca', 'pagamento'] as const, 'tipo de conta'),
      holder_doc: str(b.holder_doc, 30) ?? '',
      message: str(b.message, 300) ?? '',
      types: types.length ? types : ['Dízimo', 'Oferta'],
    };
  } else if (key === 'youtube') {
    const cur = (await getSettings(c.env, ['youtube'])).youtube;
    value = { ...cur, auto_import: bool(b.auto_import) };
  } else {
    value = {
      cult_minutes_before: int(b.cult_minutes_before, 0, 600, 'minutos antes do culto') ?? 60,
      event_minutes_before: int(b.event_minutes_before, 0, 2880, 'minutos antes do evento') ?? 120,
      word_hour: int(b.word_hour, 0, 23, 'hora da Palavra') ?? 7,
      birthdays_to_leaders: bool(b.birthdays_to_leaders),
    };
  }
  await setSetting(c.env, key, value, me.id);
  await auditLog(c, me.id, 'config_alterada', key).run();
  return c.json({ ok: true, value });
});

// ---------- notificações manuais ----------

adminRoutes.post('/notificar', async (c) => {
  const me = needLeader(c);
  const b = await body(c);
  const audience = oneOf(b.audience ?? 'members', ['all', 'members', 'leaders'] as const, 'público');
  const url = str(b.url, 200, { label: 'link' });
  if (url && !url.startsWith('/')) fail(400, 'O link deve ser uma página do app (começando com /).');
  const id = await notifyNow(c.env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
    topic: audience === 'leaders' ? 'admin' : 'avisos',
    audience,
    title: reqStr(b.title, 80, 'o título'),
    body: str(b.body, 240, { label: 'mensagem' }),
    url: url ?? '/',
    createdBy: me.id,
  });
  await auditLog(c, me.id, 'notificacao_enviada', `${audience}: ${String(b.title).slice(0, 60)}`).run();
  return c.json({ id });
});

adminRoutes.get('/notificacoes', async (c) => {
  needLeader(c);
  const { results } = await c.env.DB.prepare(
    'SELECT n.*, u.name AS author_name FROM notifications n LEFT JOIN users u ON u.id = n.created_by ORDER BY n.id DESC LIMIT 60',
  ).all();
  return c.json({ notifications: results });
});

// ---------- relatórios ----------

adminRoutes.get('/relatorios', async (c) => {
  needLeader(c);
  const year = int(c.req.query('ano'), 2000, 2100, 'ano') ?? spParts(now()).year;
  const y = String(year);
  const q = (sql: string) => c.env.DB.prepare(sql).bind(y);
  const res = await c.env.DB.batch([
    q("SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', '-3 hours') AS month, COUNT(*) AS n FROM users WHERE strftime('%Y', created_at / 1000, 'unixepoch', '-3 hours') = ? GROUP BY month"),
    q("SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', '-3 hours') AS month, COUNT(*) AS n FROM visitors WHERE strftime('%Y', created_at / 1000, 'unixepoch', '-3 hours') = ? GROUP BY month"),
    q("SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', '-3 hours') AS month, COUNT(*) AS n FROM prayers WHERE strftime('%Y', created_at / 1000, 'unixepoch', '-3 hours') = ? GROUP BY month"),
    q("SELECT strftime('%Y-%m', created_at / 1000, 'unixepoch', '-3 hours') AS month, COUNT(*) AS n FROM photos WHERE strftime('%Y', created_at / 1000, 'unixepoch', '-3 hours') = ? GROUP BY month"),
    q("SELECT strftime('%Y-%m', started_at / 1000, 'unixepoch', '-3 hours') AS month, COUNT(*) AS n FROM lives WHERE strftime('%Y', started_at / 1000, 'unixepoch', '-3 hours') = ? GROUP BY month"),
    q("SELECT substr(e.given_on, 1, 7) AS month, COUNT(*) AS n FROM (SELECT DISTINCT r.user_id, ev.id, strftime('%Y-%m-%d', ev.starts_at / 1000, 'unixepoch', '-3 hours') AS given_on FROM event_rsvps r JOIN events ev ON ev.id = r.event_id WHERE r.status = 'vou') e WHERE substr(e.given_on, 1, 4) = ? GROUP BY month"),
  ]);
  const pick = (i: number) => res[i].results as { month: string; n: number }[];
  return c.json({
    year,
    new_members: pick(0),
    visitors: pick(1),
    prayers: pick(2),
    photos: pick(3),
    lives: pick(4),
    rsvps: pick(5),
  });
});

adminRoutes.get('/auditoria', async (c) => {
  needAdmin(c);
  const { results } = await c.env.DB.prepare(
    'SELECT a.*, u.name AS user_name FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 200',
  ).all();
  return c.json({ items: results });
});
