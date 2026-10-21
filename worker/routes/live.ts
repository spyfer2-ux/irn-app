import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { auditLog, body, fail, needMedia, now, oneOf, originOf, str } from '../util';
import { DEFAULT_LIVE, getSetting, getSettings, setSettingStmt, type LiveState } from '../settings';
import { notifyNow } from '../push';
import { youtubeId } from './videos';

export const liveRoutes = new Hono<AppEnv>();

const MAX_LIVE_MS = 5 * 3600_000;

export async function publicLive(env: Env) {
  const { live, church } = await getSettings(env, ['live', 'church']);
  const active = live.active && now() - live.started_at < MAX_LIVE_MS;
  return {
    active,
    source: active ? live.source : '',
    title: active ? live.title : '',
    youtube_id: active ? live.youtube_id : '',
    started_at: active ? live.started_at : 0,
    channel_id: church.youtube_channel_id,
  };
}

export async function endLive(env: Env, userId: number | null) {
  const live = await getSetting(env, 'live');
  if (!live.active) return false;
  const stmts = [setSettingStmt(env, 'live', DEFAULT_LIVE, userId)];
  if (live.live_id)
    stmts.push(env.DB.prepare('UPDATE lives SET ended_at = ?, ended_by = ? WHERE id = ?').bind(now(), userId, live.live_id));
  await env.DB.batch(stmts);
  return true;
}

liveRoutes.get('/', async (c) => c.json(await publicLive(c.env)));

liveRoutes.post('/iniciar', async (c) => {
  const u = needMedia(c);
  const b = await body(c);
  const source = oneOf(b.source ?? 'youtube', ['youtube'] as const, 'tipo de transmissão');
  const { live, church } = await getSettings(c.env, ['live', 'church']);
  if (live.active && now() - live.started_at < MAX_LIVE_MS && b.replace !== true)
    fail(409, 'Já existe uma live em andamento. Encerre a atual antes de começar outra.');
  let ytId = '';
  if (source === 'youtube') {
    const link = str(b.youtube_url, 300, { label: 'link da live' });
    if (link) {
      ytId = youtubeId(link) ?? '';
      if (!ytId) fail(400, 'Não reconheci este link do YouTube. Use o botão "Compartilhar" da live e copie o link.');
    } else if (!church.youtube_channel_id) {
      fail(400, 'Cole o link da live do YouTube (ou cadastre o canal em Configurações).');
    }
  }
  const title = str(b.title, 120, { label: 'título' }) ?? 'Culto ao vivo';
  const t = now();
  const ins = await c.env.DB.prepare('INSERT INTO lives (source, title, youtube_id, started_at, started_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(source, title, ytId || null, t, u.id)
    .first<{ id: number }>();
  const state: LiveState = { active: true, source, title, youtube_id: ytId, started_at: t, started_by: u.id, live_id: ins!.id };
  const stmts = [setSettingStmt(c.env, 'live', state, u.id), auditLog(c, u.id, 'live_iniciada', `${source}: ${title}`)];
  if (live.active && live.live_id)
    stmts.push(c.env.DB.prepare('UPDATE lives SET ended_at = ?, ended_by = ? WHERE id = ? AND ended_at IS NULL').bind(t, u.id, live.live_id));
  await c.env.DB.batch(stmts);
  if (b.notify !== false) {
    await notifyNow(c.env, originOf(c), (p) => c.executionCtx.waitUntil(p), {
      topic: 'lives',
      audience: 'all',
      title: `AO VIVO: ${title}`,
      body: `${church.short} está ao vivo agora. Toque para assistir.`,
      url: '/ao-vivo',
      urgency: 'high',
      createdBy: u.id,
    });
  }
  return c.json({ ok: true, live: await publicLive(c.env) });
});

liveRoutes.post('/encerrar', async (c) => {
  const u = needMedia(c);
  const ended = await endLive(c.env, u.id);
  if (ended) await auditLog(c, u.id, 'live_encerrada', '').run();
  return c.json({ ok: true });
});

liveRoutes.get('/historico', async (c) => {
  needMedia(c);
  const { results } = await c.env.DB.prepare(
    'SELECT l.*, u.name AS started_by_name FROM lives l LEFT JOIN users u ON u.id = l.started_by ORDER BY l.id DESC LIMIT 30',
  ).all();
  return c.json({ lives: results });
});
