/**
 * App da IRN — servidor (Cloudflare Worker).
 * Tudo que começa com /api/ passa por aqui; o resto (telas do app) é servido direto da pasta dist.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { HttpError } from './util';
import { ensureSchema } from './schema';
import { authRoutes, loadUser, meRoutes } from './auth';
import { pushRoutes } from './push';
import { mediaRoutes } from './storage';
import { photoRoutes } from './routes/photos';
import { videoRoutes } from './routes/videos';
import { sceneRoutes } from './routes/scenes';
import { liveRoutes } from './routes/live';
import { communityRoutes } from './routes/community';
import { careRoutes } from './routes/care';
import { givingRoutes } from './routes/giving';
import { adminRoutes } from './routes/admin';
import { appRoutes } from './routes/app';
import { extrasRoutes } from './routes/extras';
import { runCron } from './cron';

const app = new Hono<AppEnv>();

let knownOrigin = '';

app.use('/api/*', async (c, next) => {
  await ensureSchema(c.env.DB);

  // Proteção contra envio de formulários por outros sites (CSRF).
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (c.req.header('x-irn') !== '1') return c.json({ error: 'Requisição bloqueada.' }, 403);
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'Origem não permitida.' }, 403);
  }

  // Guarda o endereço do app (usado nas notificações enviadas pelas tarefas automáticas).
  const origin = new URL(c.req.url).origin;
  if (origin !== knownOrigin && origin.startsWith('https://')) {
    knownOrigin = origin;
    c.executionCtx.waitUntil(
      c.env.DB.prepare("INSERT INTO meta (key, value) VALUES ('origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(origin)
        .run(),
    );
  }

  c.set('user', await loadUser(c));
  await next();
  try {
    c.res.headers.set('x-content-type-options', 'nosniff');
    if (!c.res.headers.has('cache-control')) c.res.headers.set('cache-control', 'no-store');
  } catch {
    /* resposta com cabeçalhos imutáveis */
  }
});

app.route('/api/auth', authRoutes);
app.route('/api/me', meRoutes);
app.route('/api/push', pushRoutes);
app.route('/api/media', mediaRoutes);
app.route('/api/fotos', photoRoutes);
app.route('/api/videos', videoRoutes);
app.route('/api/cenas', sceneRoutes);
app.route('/api/live', liveRoutes);
app.route('/api', communityRoutes);
app.route('/api', careRoutes);
app.route('/api', givingRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', appRoutes);
app.route('/api', extrasRoutes);

app.all('/api/*', (c) => c.json({ error: 'Não encontrado.' }, 404));
app.all('*', (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error('erro', err);
  return c.json({ error: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        await ensureSchema(env.DB);
        await runCron(env, event.scheduledTime);
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
