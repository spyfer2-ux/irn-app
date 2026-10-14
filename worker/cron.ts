/**
 * Tarefas automáticas (rodam a cada 5 minutos):
 * - termina de enviar notificações pendentes;
 * - lembrete antes de cada culto e de cada evento;
 * - avisa a Palavra do dia e a Mensagem do Pastor;
 * - parabeniza aniversariantes e avisa a liderança;
 * - busca vídeos novos do canal do YouTube (1 vez por hora);
 * - encerra lives esquecidas abertas e faz a limpeza diária.
 */
import type { Env } from './types';
import { now, nextCults, spParts } from './util';
import { getSettings } from './settings';
import { drain, notify } from './push';
import { endLive } from './routes/live';
import { syncYoutube } from './routes/videos';
import { fmtWhen } from './routes/community';
import { cleanupMedia } from './storage';

async function mark(env: Env, key: string): Promise<boolean> {
  const r = await env.DB.prepare('INSERT INTO marks (key, created_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now()).run();
  return !!r.meta.changes;
}

export async function getOrigin(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'origin'").first<{ value: string }>();
  return row?.value ?? 'https://irn.app';
}

const step = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    console.error(`tarefa ${name} falhou`, String(e));
  }
};

export async function runCron(env: Env, at = now()): Promise<void> {
  const { schedule, reminders, church, live, youtube } = await getSettings(env, ['schedule', 'reminders', 'church', 'live', 'youtube']);
  const p = spParts(at);
  const origin = await getOrigin(env);

  await step('lembrete de culto', async () => {
    if (!reminders.cult_minutes_before) return;
    for (const cult of nextCults(schedule, at, 2)) {
      const remindAt = cult.at - reminders.cult_minutes_before * 60000;
      if (at < remindAt || at >= cult.at) continue;
      if (!(await mark(env, `culto:${cult.date}:${cult.id}:${cult.time}`))) continue;
      const [h, m] = cult.time.split(':');
      await notify(env, {
        topic: 'cultos',
        audience: 'all',
        title: `Hoje tem ${cult.title} às ${Number(h)}h${m !== '00' ? m : ''}`,
        body: `Te esperamos! ${church.address}${church.district ? ` – ${church.district}` : ''}.`,
        url: '/igreja',
      });
    }
  });

  await step('lembrete de evento', async () => {
    if (!reminders.event_minutes_before) return;
    const { results } = await env.DB.prepare(
      'SELECT id, title, starts_at, location, visibility FROM events WHERE canceled = 0 AND reminded = 0 AND starts_at > ? AND starts_at <= ? LIMIT 5',
    )
      .bind(at, at + reminders.event_minutes_before * 60000)
      .all<{ id: number; title: string; starts_at: number; location: string | null; visibility: string }>();
    for (const e of results) {
      const r = await env.DB.prepare('UPDATE events SET reminded = 1 WHERE id = ? AND reminded = 0').bind(e.id).run();
      if (!r.meta.changes) continue;
      await notify(env, {
        topic: 'eventos',
        audience: e.visibility === 'public' ? 'all' : 'members',
        title: `Daqui a pouco: ${e.title}`,
        body: `${fmtWhen(e.starts_at)}${e.location ? ` · ${e.location}` : ''}`,
        url: `/agenda/${e.id}`,
      });
    }
  });

  await step('palavra do dia', async () => {
    if (p.hour < reminders.word_hour) return;
    const w = await env.DB.prepare('SELECT id, title, reference, visibility FROM words WHERE day = ? AND notified = 0 ORDER BY id LIMIT 1')
      .bind(p.ymd)
      .first<{ id: number; title: string; reference: string | null; visibility: string }>();
    if (!w) return;
    const r = await env.DB.prepare('UPDATE words SET notified = 1 WHERE id = ? AND notified = 0').bind(w.id).run();
    if (!r.meta.changes) return;
    await notify(env, {
      topic: 'palavra',
      audience: w.visibility === 'public' ? 'all' : 'members',
      title: `Palavra do dia: ${w.title}`,
      body: w.reference ?? 'Toque para ler.',
      url: `/palavra/${w.id}`,
    });
  });

  await step('mensagem do pastor', async () => {
    if (p.hour < reminders.word_hour) return;
    const m = await env.DB.prepare(
      'SELECT id, title, reference, visibility FROM pastor_messages WHERE day = ? AND notified = 0 ORDER BY id LIMIT 1',
    )
      .bind(p.ymd)
      .first<{ id: number; title: string; reference: string | null; visibility: string }>();
    if (!m) return;
    const r = await env.DB.prepare('UPDATE pastor_messages SET notified = 1 WHERE id = ? AND notified = 0').bind(m.id).run();
    if (!r.meta.changes) return;
    await notify(env, {
      topic: 'palavra',
      audience: m.visibility === 'public' ? 'all' : 'members',
      title: `Mensagem do Pastor: ${m.title}`,
      body: m.reference ?? 'Toque para ler e ouvir.',
      url: `/mensagem/${m.id}`,
    });
  });

  await step('aniversários', async () => {
    if (p.hour < 8) return;
    if (!(await mark(env, `aniv:${p.ymd}`))) return;
    const md = p.ymd.slice(5);
    const { results } = await env.DB.prepare(
      "SELECT id, name FROM users WHERE status = 'aprovado' AND birthday IS NOT NULL AND substr(birthday, 6, 5) = ?",
    )
      .bind(md)
      .all<{ id: number; name: string }>();
    if (!results.length) return;
    for (const person of results.slice(0, 20)) {
      await notify(env, {
        topic: 'pessoal',
        audience: `user:${person.id}`,
        title: `Feliz aniversário, ${person.name.split(' ')[0]}!`,
        body: `A família ${church.short} celebra a sua vida hoje. Deus te abençoe!`,
        url: '/',
      });
    }
    if (reminders.birthdays_to_leaders) {
      await notify(env, {
        topic: 'admin',
        audience: 'leaders',
        title: 'Aniversariantes de hoje',
        body: results.map((r) => r.name).join(', ').slice(0, 250),
        url: '/admin/aniversariantes',
      });
    }
  });

  await step('live esquecida', async () => {
    if (live.active && at - live.started_at > 5 * 3600_000) await endLive(env, null);
  });

  await step('youtube', async () => {
    if (youtube.auto_import && at - youtube.last_sync > 55 * 60000) await syncYoutube(env);
  });

  await step('limpeza', async () => {
    if (p.hour !== 3 || !(await mark(env, `limpeza:${p.ymd}`))) return;
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(at),
      env.DB.prepare('DELETE FROM rate WHERE reset_at < ?').bind(at),
      env.DB.prepare('DELETE FROM marks WHERE created_at < ?').bind(at - 60 * 86400000),
      env.DB.prepare('DELETE FROM notifications WHERE created_at < ? AND done = 1').bind(at - 120 * 86400000),
      env.DB.prepare('DELETE FROM audit WHERE created_at < ?').bind(at - 730 * 86400000),
    ]);
    await cleanupMedia(env);
  });

  await step('envio de notificações', async () => {
    await drain(env, origin, 20);
  });
}
