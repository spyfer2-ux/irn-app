/** Rotas gerais: dados iniciais do app, tela inicial, ícones e manifesto do app instalável. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { addDays, isLeader, isMember, nextCults, now, spParts, visibleSet } from '../util';
import { getSettings } from '../settings';
import { googleConfigured, meView } from '../auth';
import { getMedia, serveMedia, storageMode } from '../storage';
import { publicLive } from './live';

export const appRoutes = new Hono<AppEnv>();

appRoutes.get('/boot', async (c) => {
  const u = c.get('user');
  const { church, schedule, giving, stream } = await getSettings(c.env, ['church', 'schedule', 'giving', 'stream']);
  const host = new URL(c.req.url).hostname;
  return c.json({
    user: u ? meView(u) : null,
    church,
    schedule,
    features: {
      google: googleConfigured(c.env),
      dev_login: c.env.DEV_LOGIN === '1' && (host === 'localhost' || host === '127.0.0.1'),
      storage: storageMode(c.env),
      video_upload: !!c.env.BUCKET,
      stream_ready: !!(stream.whip_url && stream.whep_url),
      giving_public: giving.visible_to === 'public',
    },
    now: now(),
  });
});

appRoutes.get('/home', async (c) => {
  const u = c.get('user');
  const member = isMember(u);
  const vis = visibleSet(u);
  const inVis = `(${vis.map(() => '?').join(',')})`;
  const t = now();
  const today = spParts(t).ymd;
  const { schedule } = await getSettings(c.env, ['schedule']);
  const live = await publicLive(c.env);
  const db = c.env.DB;

  const stmts: D1PreparedStatement[] = [
    db.prepare(`SELECT * FROM words WHERE visibility IN ${inVis} AND day <= ? ORDER BY day DESC, id DESC LIMIT 1`).bind(...vis, today),
    db
      .prepare(
        `SELECT id, title, body, image_id, link, pinned, created_at FROM notices WHERE visibility IN ${inVis}
         AND (expires_on IS NULL OR expires_on >= ?) ORDER BY pinned DESC, id DESC LIMIT 4`,
      )
      .bind(...vis, today),
    db
      .prepare(
        `SELECT id, title, starts_at, ends_at, location, cover_id, category FROM events WHERE visibility IN ${inVis}
         AND canceled = 0 AND COALESCE(ends_at, starts_at + 10800000) >= ? ORDER BY starts_at LIMIT 3`,
      )
      .bind(...vis, t),
    db
      .prepare(
        `SELECT id, source, youtube_id, poster_id, title, category, duration, published_at FROM videos
         WHERE hidden = 0 AND visibility IN ${inVis} ORDER BY published_at DESC LIMIT 6`,
      )
      .bind(...vis),
  ];
  if (member) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i).slice(5));
    stmts.push(
      db.prepare('SELECT id, thumb_id, width, height, album_id FROM photos ORDER BY id DESC LIMIT 9'),
      db
        .prepare(
          `SELECT id, name, picture, substr(birthday, 6, 5) AS md FROM users WHERE status = 'aprovado' AND show_birthday = 1
           AND birthday IS NOT NULL AND substr(birthday, 6, 5) IN (${days.map(() => '?').join(',')})`,
        )
        .bind(...days),
      db
        .prepare(
          `SELECT c.id, c.title, c.start_date, c.end_date, c.cover_id, c.daily_goal,
             EXISTS (SELECT 1 FROM campaign_members m WHERE m.campaign_id = c.id AND m.user_id = ?) AS joined,
             EXISTS (SELECT 1 FROM campaign_checkins k WHERE k.campaign_id = c.id AND k.user_id = ? AND k.day = ?) AS done_today
           FROM campaigns c WHERE c.start_date <= ? AND c.end_date >= ? AND c.visibility IN ${inVis} ORDER BY c.end_date LIMIT 3`,
        )
        .bind(u!.id, u!.id, today, today, today, ...vis),
    );
  }
  let pendingIdx = -1;
  if (isLeader(u)) {
    pendingIdx = stmts.length;
    stmts.push(
      db.prepare(
        `SELECT (SELECT COUNT(*) FROM users WHERE status = 'pendente') AS users,
                (SELECT COUNT(*) FROM testimonies WHERE status = 'pendente') AS testimonies,
                (SELECT COUNT(*) FROM visitors WHERE status = 'novo') AS visitors,
                (SELECT COUNT(*) FROM ministry_requests WHERE status = 'novo') AS requests,
                (SELECT COUNT(*) FROM help_posts WHERE status = 'pendente') AS help`,
      ),
    );
  }
  const pastorIdx = stmts.length;
  stmts.push(
    db
      .prepare(
        `SELECT p.id, p.day, p.title, p.reference, p.verse, p.author, p.image_id, p.audio_id, p.media_url, m.duration AS audio_duration
         FROM pastor_messages p LEFT JOIN media m ON m.id = p.audio_id
         WHERE p.visibility IN ${inVis} AND p.day <= ? ORDER BY p.day DESC, p.id DESC LIMIT 1`,
      )
      .bind(...vis, today),
  );
  const res = await db.batch(stmts);
  const rows = (i: number) => (res[i]?.results ?? []) as Record<string, unknown>[];
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(today, i).slice(5));
  const order = (md: string) => days7.indexOf(md);
  const birthdays = member
    ? (rows(5) as { md: string }[]).sort((a, b) => order(a.md) - order(b.md)).map((p) => ({ ...p, today: p.md === today.slice(5) }))
    : [];
  return c.json({
    today,
    live,
    next_cults: nextCults(schedule, t).slice(0, 4),
    word: rows(0)[0] ?? null,
    notices: rows(1),
    events: rows(2),
    videos: rows(3),
    photos: member ? rows(4) : [],
    birthdays,
    campaigns: member ? rows(6) : [],
    pending: pendingIdx >= 0 ? rows(pendingIdx)[0] ?? null : null,
    pastor: rows(pastorIdx)[0] ?? null,
  });
});

// ---------- logo e ícones (o admin pode trocar pela logo oficial) ----------

const BRAND: Record<string, 'logo_id' | 'icon192_id' | 'icon512_id' | 'maskable_id'> = {
  logo: 'logo_id',
  'icon-192.png': 'icon192_id',
  'icon-512.png': 'icon512_id',
  'maskable-512.png': 'maskable_id',
  'apple-touch-icon.png': 'icon192_id',
};

appRoutes.get('/brand/:name', async (c) => {
  const name = c.req.param('name');
  const field = BRAND[name];
  if (!field) return c.json({ error: 'Não encontrado.' }, 404);
  const { church } = await getSettings(c.env, ['church']);
  const id = church[field];
  if (id) {
    const m = await getMedia(c.env, id);
    if (m && m.status === 'ready') return serveMedia(c, m, { cache: 'public, max-age=3600' });
  }
  const fallback = name === 'logo' ? 'logo.png' : name === 'apple-touch-icon.png' ? 'apple-touch-icon.png' : name;
  const res = await c.env.ASSETS.fetch(new Request(new URL(`/icons/${fallback}`, c.req.url)));
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'public, max-age=3600');
  return out;
});

appRoutes.get('/manifest.webmanifest', async (c) => {
  const { church } = await getSettings(c.env, ['church']);
  const manifest = {
    id: '/',
    name: church.name,
    short_name: church.short || 'IRN',
    description: `App oficial — ${church.name}`,
    lang: 'pt-BR',
    start_url: '/?origem=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b1d3f',
    theme_color: '#0b1d3f',
    categories: ['lifestyle', 'social'],
    icons: [
      { src: '/api/brand/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/api/brand/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Ao vivo', url: '/ao-vivo' },
      { name: 'Fotos', url: '/fotos' },
      { name: 'Dízimos e ofertas', url: '/dizimos' },
      { name: 'Pedir oração', url: '/oracao' },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=600' },
  });
});
