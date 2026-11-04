import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { auditLog, body, fail, isMedia, needMedia, needMember, now, oneOf, originOf, rateLimit, str } from '../util';
import { DEFAULT_LIVE, getSetting, getSettings, setSettingStmt, type LiveState } from '../settings';
import { notify, notifyNow, type NotifyInput } from '../push';
import { googleConfigured } from '../auth';
import { youtubeId } from './videos';
import * as Y from '../youtube';

export const liveRoutes = new Hono<AppEnv>();

const MAX_LIVE_MS = 5 * 3600_000;
/** Uma live criada pelo app vale por até 6 horas. */
const SESSION_MAX_MS = 6 * 3600_000;
/** Live pela câmera do app sem nenhum dado chegando há esse tempo: o celular desligou ou fechou o app. */
const RELAY_SILENT_MS = 15 * 60_000;
/** Live por outro app (Larix etc.) sem vídeo chegando ao YouTube há esse tempo. */
const EXTERNAL_SILENT_MS = 20 * 60_000;

export async function publicLive(env: Env) {
  const { live, church } = await getSettings(env, ['live', 'church']);
  return publicView(live, church.youtube_channel_id);
}

function publicView(live: LiveState, channelId: string) {
  const active = live.active && now() - live.started_at < MAX_LIVE_MS;
  return {
    active,
    source: active ? live.source : '',
    title: active ? live.title : '',
    youtube_id: active ? live.youtube_id : '',
    started_at: active ? live.started_at : 0,
    channel_id: channelId,
  };
}

// ---------------- sessões (lives criadas pelo app no YouTube de cada pessoa) ----------------

export interface LiveSession {
  id: number;
  user_id: number;
  broadcast_id: string;
  title: string;
  privacy: string;
  mode: 'app' | 'externo';
  notify: number;
  status: 'preparada' | 'no_ar' | 'encerrada';
  live_id: number | null;
  relay_seen_at: number | null;
  inactive_since: number | null;
  created_at: number;
  ended_at: number | null;
}

async function mySession(env: Env, userId: number, id?: number): Promise<LiveSession | null> {
  if (id !== undefined)
    return env.DB.prepare('SELECT * FROM live_sessions WHERE id = ? AND user_id = ?').bind(id, userId).first<LiveSession>();
  return env.DB.prepare(
    "SELECT * FROM live_sessions WHERE user_id = ? AND status != 'encerrada' AND created_at > ? ORDER BY id DESC LIMIT 1",
  )
    .bind(userId, now() - SESSION_MAX_MS)
    .first<LiveSession>();
}

/** O que o app do dono da live precisa saber (inclui a chave de transmissão, que é dele). */
async function sessionView(env: Env, s: LiveSession, acc: Y.YtAccount | null) {
  const key = acc ? await Y.unseal(env, acc.stream_key_enc) : null;
  const url = acc?.ingest_rtmps || acc?.ingest_rtmp || null;
  return {
    id: s.id,
    status: s.status,
    mode: s.mode,
    title: s.title,
    privacy: s.privacy,
    notify: !!s.notify,
    broadcast_id: s.broadcast_id,
    watch_url: `https://www.youtube.com/watch?v=${s.broadcast_id}`,
    studio_url: `https://studio.youtube.com/video/${s.broadcast_id}/livestreaming`,
    created_at: s.created_at,
    rtmp: key && url ? { url, key } : null,
  };
}

async function markEnded(env: Env, sessionId: number) {
  await env.DB.prepare("UPDATE live_sessions SET status = 'encerrada', ended_at = ? WHERE id = ? AND status != 'encerrada'")
    .bind(now(), sessionId)
    .run();
}

/** Marca a sessão como encerrada e termina a live no YouTube (encerra se estava no ar; apaga se nunca começou). */
async function closeSession(env: Env, s: LiveSession) {
  await markEnded(env, s.id);
  try {
    const acc = await Y.getAccount(env, s.user_id);
    if (!acc) return;
    const token = await Y.accessToken(env, acc);
    await Y.finishBroadcast(env, token, s.broadcast_id);
  } catch (e) {
    console.error('encerrar live no YouTube', s.id, String(e));
  }
}

export async function endLive(env: Env, userId: number | null) {
  const live = await getSetting(env, 'live');
  if (!live.active) return false;
  const stmts = [setSettingStmt(env, 'live', DEFAULT_LIVE, userId)];
  if (live.live_id)
    stmts.push(env.DB.prepare('UPDATE lives SET ended_at = ?, ended_by = ? WHERE id = ?').bind(now(), userId, live.live_id));
  await env.DB.batch(stmts);
  if (live.live_id) {
    const { results } = await env.DB.prepare("SELECT * FROM live_sessions WHERE live_id = ? AND status != 'encerrada'")
      .bind(live.live_id)
      .all<LiveSession>();
    for (const s of results) await closeSession(env, s);
  }
  return true;
}

/** A live chegou no YouTube: aparece no app para todos (e sai a notificação, se pediram). */
async function goLive(env: Env, s: LiveSession, origin: string, waitUntil: ((p: Promise<unknown>) => void) | null) {
  const claim = await env.DB.prepare("UPDATE live_sessions SET status = 'no_ar', inactive_since = NULL WHERE id = ? AND status = 'preparada'")
    .bind(s.id)
    .run();
  if (!claim.meta.changes) return;
  const { live, church } = await getSettings(env, ['live', 'church']);
  const t = now();
  const ins = await env.DB.prepare('INSERT INTO lives (source, title, youtube_id, started_at, started_by) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind('youtube', s.title, s.broadcast_id, t, s.user_id)
    .first<{ id: number }>();
  const state: LiveState = {
    active: true,
    source: 'youtube',
    title: s.title,
    youtube_id: s.broadcast_id,
    started_at: t,
    started_by: s.user_id,
    live_id: ins!.id,
  };
  const stmts = [
    setSettingStmt(env, 'live', state, s.user_id),
    env.DB.prepare('UPDATE live_sessions SET live_id = ? WHERE id = ?').bind(ins!.id, s.id),
    env.DB.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(
      s.user_id,
      'live_iniciada',
      `youtube (${s.mode === 'app' ? 'câmera do app' : 'outro app'}): ${s.title}`.slice(0, 500),
      t,
    ),
  ];
  if (live.active && live.live_id)
    stmts.push(env.DB.prepare('UPDATE lives SET ended_at = ? WHERE id = ? AND ended_at IS NULL').bind(t, live.live_id));
  await env.DB.batch(stmts);
  if (s.notify) {
    const n: NotifyInput = {
      topic: 'lives',
      audience: 'all',
      title: `AO VIVO: ${s.title}`,
      body: `${church.short} está ao vivo agora. Toque para assistir.`,
      url: '/ao-vivo',
      urgency: 'high',
      createdBy: s.user_id,
    };
    if (waitUntil) await notifyNow(env, origin, waitUntil, n);
    else await notify(env, n);
  }
}

/** Confere no YouTube as lives criadas pelo app (roda a cada 5 minutos, junto das outras tarefas). */
export async function sweepSessions(env: Env, origin: string, at = now()) {
  const { results } = await env.DB.prepare("SELECT * FROM live_sessions WHERE status != 'encerrada' ORDER BY id LIMIT 20").all<LiveSession>();
  if (!results.length) return;
  const live = await getSetting(env, 'live');
  for (const s of results) {
    const linked = live.active && !!s.live_id && live.live_id === s.live_id;
    const finish = async () => {
      if (linked) await endLive(env, null);
      else await closeSession(env, s);
    };
    try {
      if (at - s.created_at > SESSION_MAX_MS) {
        await finish();
        continue;
      }
      if (s.status === 'no_ar' && !linked) {
        // A live do app foi encerrada (ou trocada por outra) e esta ficou para trás.
        await closeSession(env, s);
        continue;
      }
      const acc = await Y.getAccount(env, s.user_id);
      if (!acc) {
        if (linked) await endLive(env, null);
        await markEnded(env, s.id);
        continue;
      }
      const token = await Y.accessToken(env, acc);
      const bc = await Y.broadcastStatus(env, token, s.broadcast_id);
      if (!bc || bc.life === 'complete' || bc.life === 'revoked') {
        if (linked) await endLive(env, null);
        await markEnded(env, s.id);
        continue;
      }
      if (s.status === 'preparada') {
        if (bc.life === 'live' || bc.life === 'liveStarting') await goLive(env, s, origin, null);
        else if (at - s.created_at > 3 * 3600_000) await closeSession(env, s);
        continue;
      }
      if (s.mode === 'app') {
        if (at - (s.relay_seen_at ?? s.created_at) > RELAY_SILENT_MS) await finish();
        continue;
      }
      const st = acc.stream_id ? await Y.streamStatus(env, token, acc.stream_id) : null;
      if (st && st.status !== 'active') {
        if (!s.inactive_since)
          await env.DB.prepare('UPDATE live_sessions SET inactive_since = ? WHERE id = ?').bind(at, s.id).run();
        else if (at - s.inactive_since > EXTERNAL_SILENT_MS) await finish();
      } else if (s.inactive_since) {
        await env.DB.prepare('UPDATE live_sessions SET inactive_since = NULL WHERE id = ?').bind(s.id).run();
      }
    } catch (e) {
      console.error('conferir live do app', s.id, String(e));
    }
  }
}

// ---------------- rotas ----------------

liveRoutes.get('/', async (c) => {
  const { live, church } = await getSettings(c.env, ['live', 'church']);
  const view = publicView(live, church.youtube_channel_id);
  const u = c.get('user');
  const approved = !!u && u.status === 'aprovado';
  const mine = view.active && approved && live.started_by === u!.id;
  return c.json({ ...view, mine, can_end: view.active && approved && (mine || isMedia(u)) });
});

/** Live por link (alguém já está ao vivo no YouTube por outro canal/app): só a equipe de mídia. */
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

/** Encerrar: quem começou a live ou a equipe de mídia. */
liveRoutes.post('/encerrar', async (c) => {
  const u = needMember(c);
  const live = await getSetting(c.env, 'live');
  if (live.active && !isMedia(u) && live.started_by !== u.id)
    fail(403, 'Só quem começou a live (ou a equipe de mídia) pode encerrar.');
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

// ---------- live pela câmera do app (no YouTube da própria pessoa) ----------

/** Situação da conta do YouTube da pessoa e da live dela em andamento. */
liveRoutes.get('/youtube/conta', async (c) => {
  const u = needMember(c);
  const acc = await Y.getAccount(c.env, u.id);
  const s = await mySession(c.env, u.id);
  const live = await getSetting(c.env, 'live');
  const liveActive = live.active && now() - live.started_at < MAX_LIVE_MS;
  return c.json({
    configured: googleConfigured(c.env),
    relay: !!c.env.LIVE_RELAY,
    connected: !!acc,
    email: acc?.email ?? null,
    channel: acc?.channel_id ? { id: acc.channel_id, title: acc.channel_title ?? '', thumb: acc.channel_thumb } : null,
    session: s ? await sessionView(c.env, s, acc) : null,
    busy: liveActive && !(s && s.live_id && s.live_id === live.live_id),
  });
});

/** Confere de novo o canal (depois que a pessoa cria o canal no YouTube). */
liveRoutes.post('/youtube/canal', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `yt-canal:${u.id}`, 30, 3600_000);
  const acc = await Y.getAccount(c.env, u.id);
  if (!acc) fail(401, 'Conecte sua conta do YouTube primeiro.', 'reconectar');
  try {
    const token = await Y.accessToken(c.env, acc);
    const ch = await Y.fetchChannel(c.env, token);
    await Y.updateChannel(c.env, u.id, ch);
    return c.json({ channel: ch });
  } catch (e) {
    throw Y.ytHttpError(e);
  }
});

liveRoutes.post('/youtube/desconectar', async (c) => {
  const u = needMember(c);
  if (await mySession(c.env, u.id)) fail(409, 'Encerre a live antes de desconectar o YouTube.');
  await Y.forgetAccount(c.env, u.id);
  await auditLog(c, u.id, 'youtube_desconectado', '').run();
  return c.json({ ok: true });
});

/** Cria a live no YouTube da pessoa (ainda sem aparecer no app: aparece quando o vídeo chegar). */
liveRoutes.post('/youtube/preparar', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `yt-preparar:${u.id}`, 12, 3600_000);
  const b = await body(c);
  const title = (str(b.title, 100, { label: 'título' }) ?? 'Culto ao vivo').replace(/[<>]/g, '');
  const privacy = oneOf(b.privacy ?? 'public', ['public', 'unlisted'] as const, 'privacidade');
  const mode = oneOf(b.mode ?? 'app', ['app', 'externo'] as const, 'modo');
  const notifyAll = b.notify !== false;
  if (mode === 'app' && !c.env.LIVE_RELAY) fail(503, 'A transmissão pela câmera do app ainda não foi ativada no servidor.', 'sem_ponte');

  const live = await getSetting(c.env, 'live');
  if (live.active && now() - live.started_at < MAX_LIVE_MS)
    fail(409, 'Já tem uma live no ar no app. Ela precisa ser encerrada antes de começar outra.', 'ocupado');
  const old = await mySession(c.env, u.id);
  if (old?.status === 'no_ar') fail(409, 'Você já está com uma live no ar.', 'ocupado');
  if (old) await closeSession(c.env, old);

  const acc = await Y.getAccount(c.env, u.id);
  if (!acc) fail(401, 'Conecte sua conta do YouTube primeiro.', 'reconectar');
  try {
    const token = await Y.accessToken(c.env, acc);
    if (!acc.channel_id) {
      const ch = await Y.fetchChannel(c.env, token);
      await Y.updateChannel(c.env, u.id, ch);
      if (!ch) fail(409, 'Esta conta do Google ainda não tem um canal no YouTube.', 'sem_canal');
      acc.channel_id = ch.id;
    }
    const ingest = await Y.ensureStream(c.env, acc, token);
    const { church } = await getSettings(c.env, ['church']);
    const broadcastId = await Y.createBroadcast(c.env, token, {
      title,
      privacy,
      description: `${church.name} — ao vivo pelo app da igreja.`,
    });
    try {
      await Y.bindBroadcast(c.env, token, broadcastId, ingest.streamId);
    } catch (e) {
      await Y.finishBroadcast(c.env, token, broadcastId).catch(() => undefined);
      throw e;
    }
    const s = await c.env.DB.prepare(
      'INSERT INTO live_sessions (user_id, broadcast_id, title, privacy, mode, notify, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
      .bind(u.id, broadcastId, title, privacy, mode, notifyAll ? 1 : 0, now())
      .first<LiveSession>();
    await auditLog(c, u.id, 'live_preparada', `${mode}: ${title}`).run();
    return c.json({ session: await sessionView(c.env, s!, acc) });
  } catch (e) {
    throw Y.ytHttpError(e);
  }
});

/** O celular pergunta se o YouTube já recebeu o vídeo; quando a live entra no ar, aparece no app para todos. */
liveRoutes.post('/youtube/conferir', async (c) => {
  const u = needMember(c);
  await rateLimit(c.env, `yt-conferir:${u.id}`, 300, 3600_000);
  const b = await body(c);
  const s = await mySession(c.env, u.id, Number(b.sessao));
  if (!s) fail(404, 'Live não encontrada.');
  if (s.status === 'encerrada') return c.json({ status: 'encerrada' });
  const acc = await Y.getAccount(c.env, u.id);
  if (!acc) fail(401, 'Conecte sua conta do YouTube de novo.', 'reconectar');
  try {
    const token = await Y.accessToken(c.env, acc);
    const [bc, st] = await Promise.all([
      Y.broadcastStatus(c.env, token, s.broadcast_id),
      acc.stream_id ? Y.streamStatus(c.env, token, acc.stream_id) : Promise.resolve(null),
    ]);
    if (!bc || bc.life === 'complete' || bc.life === 'revoked') {
      const live = await getSetting(c.env, 'live');
      if (live.active && s.live_id && live.live_id === s.live_id) await endLive(c.env, u.id);
      await markEnded(c.env, s.id);
      return c.json({ status: 'encerrada', youtube: bc?.life ?? 'apagada' });
    }
    let status: LiveSession['status'] = s.status;
    if (s.status === 'preparada') {
      let life = bc.life;
      // A live começa sozinha quando o vídeo chega; se o YouTube demorar, o celular pede para forçar.
      if (b.forcar === true && st?.status === 'active' && (life === 'ready' || life === 'created')) {
        try {
          await Y.transition(c.env, token, s.broadcast_id, 'live');
          life = 'liveStarting';
        } catch (e) {
          console.error('forçar live', String(e));
        }
      }
      if (life === 'live' || life === 'liveStarting') {
        await goLive(c.env, s, originOf(c), (p) => c.executionCtx.waitUntil(p));
        status = 'no_ar';
      }
    }
    return c.json({ status, youtube: bc.life, stream: st?.status ?? null, health: st?.health ?? null });
  } catch (e) {
    throw Y.ytHttpError(e);
  }
});

/** Desiste de uma live que ainda não entrou no ar (ou encerra a sua). */
liveRoutes.post('/youtube/cancelar', async (c) => {
  const u = needMember(c);
  const b = await body(c);
  const s = await mySession(c.env, u.id, Number(b.sessao));
  if (!s || s.status === 'encerrada') return c.json({ ok: true });
  const live = await getSetting(c.env, 'live');
  if (live.active && s.live_id && live.live_id === s.live_id) await endLive(c.env, u.id);
  else await closeSession(c.env, s);
  await auditLog(c, u.id, 'live_cancelada', s.title).run();
  return c.json({ ok: true });
});

/** WebSocket do celular → ponte (Durable Object) → servidor de entrada do YouTube. */
liveRoutes.get('/relay', async (c) => {
  if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') fail(426, 'Esperava uma conexão WebSocket.');
  const origin = c.req.header('origin');
  if (origin && origin !== originOf(c)) fail(403, 'Origem não permitida.');
  const u = needMember(c);
  if (!c.env.LIVE_RELAY) fail(503, 'A transmissão pela câmera do app ainda não foi ativada no servidor.', 'sem_ponte');
  const s = await mySession(c.env, u.id, Number(c.req.query('sessao')));
  if (!s || s.status === 'encerrada' || now() - s.created_at > SESSION_MAX_MS) fail(404, 'Live não encontrada ou já encerrada.');
  const acc = await Y.getAccount(c.env, u.id);
  const target = relayTarget(c.env, acc, new URL(c.req.url).hostname);
  const stub = c.env.LIVE_RELAY.get(c.env.LIVE_RELAY.idFromName(`sessao:${s.id}`));
  return stub.fetch('https://ponte.interna/', {
    headers: {
      upgrade: 'websocket',
      'x-relay-host': target.host,
      'x-relay-port': String(target.port),
      'x-relay-tls': target.tls ? '1' : '0',
      'x-relay-session': String(s.id),
    },
  });
});

/** Para onde a ponte pode ligar: só servidores do YouTube (nos testes locais, um servidor RTMP na própria máquina). */
export function relayTarget(env: Env, acc: Y.YtAccount | null, requestHost: string): { host: string; port: number; tls: boolean } {
  const raw = acc?.ingest_rtmps || acc?.ingest_rtmp;
  if (!raw) fail(409, 'A chave de transmissão do YouTube não foi encontrada. Comece a live de novo.');
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    fail(409, 'Endereço de transmissão inválido.');
  }
  const tls = u.protocol === 'rtmps:';
  if (!tls && u.protocol !== 'rtmp:') fail(409, 'Endereço de transmissão inválido.');
  const host = u.hostname.toLowerCase();
  // Testes locais (DEV_LOGIN=1 e app aberto em localhost): aceita um servidor RTMP de teste num IP da própria rede.
  const testServer = host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const devLocal = env.DEV_LOGIN === '1' && (requestHost === '127.0.0.1' || requestHost === 'localhost');
  if (!(host === 'youtube.com' || host.endsWith('.youtube.com')) && !(testServer && devLocal))
    fail(400, 'Servidor de transmissão não permitido.');
  return { host, port: u.port ? Number(u.port) : tls ? 443 : 1935, tls };
}

