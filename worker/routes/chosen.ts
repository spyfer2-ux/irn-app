/**
 * "Novidades de The Chosen": Shorts (reels) e vídeos novos do canal OFICIAL da série no YouTube.
 * O app lê sozinho o feed público do canal (sem chave nem senha), algumas vezes por dia, e guarda só o código
 * de cada vídeo — quem toca é o player do YouTube. A equipe de mídia pode esconder um vídeo ou transformá-lo em cena.
 */
import { Hono } from 'hono';
import type { AppEnv, Env } from '../types';
import { fail, needMedia, now } from '../util';
import { decodeXml } from './videos';

export const chosenRoutes = new Hono<AppEnv>();

/** Canal oficial da série The Chosen no YouTube (@TheChosenSeries). */
export const CHOSEN_CHANNEL = 'UCBXOFnNTULFaAnj24PAeblg';
/** De quanto em quanto tempo o app confere o feed. */
const EVERY = 3 * 3600_000;

export interface FeedItem {
  youtube_id: string;
  title: string;
  kind: 'short' | 'video';
  ref: string | null;
  published_at: number;
}

/** Referência bíblica que o próprio canal põe no título: "Jesus Heals the Leper (Matthew 8)" → "Matthew 8". */
export function refFromTitle(title: string): string | null {
  const m = title.match(/\(([1-3]?\s?[\p{L}]+(?:\s[\p{L}]+)?\s\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?)\)/u);
  return m ? m[1] : null;
}

/** Lê o XML do feed do YouTube. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const [, e] of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const title = decodeXml(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim().slice(0, 200) || 'The Chosen';
    const link = e.match(/<link rel="alternate" href="([^"]+)"/)?.[1] ?? '';
    out.push({
      youtube_id: id,
      title,
      kind: link.includes('/shorts/') ? 'short' : 'video',
      ref: refFromTitle(title),
      published_at: Date.parse(e.match(/<published>([^<]+)<\/published>/)?.[1] ?? '') || now(),
    });
  }
  return out;
}

const lastSync = async (env: Env) =>
  Number((await env.DB.prepare("SELECT value FROM meta WHERE key = 'chosen_sync'").first<{ value: string }>())?.value ?? 0);

/** Busca o feed e guarda os vídeos novos (os que já estão no app não mudam). */
export async function syncChosen(env: Env, force = false): Promise<{ added: number; error?: string }> {
  const at = now();
  if (!force && at - (await lastSync(env)) < EVERY) return { added: 0 };
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('chosen_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(String(at))
    .run();
  let xml = '';
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHOSEN_CHANNEL}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (app IRN)' },
    });
    if (!res.ok) throw new Error(`YouTube respondeu ${res.status}`);
    xml = await res.text();
  } catch (e) {
    console.error('feed The Chosen falhou', String(e));
    return { added: 0, error: 'Não consegui acessar o YouTube agora.' };
  }
  const items = parseFeed(xml);
  if (!items.length) return { added: 0 };
  const res = await env.DB.batch(
    items.map((i) =>
      env.DB.prepare(
        `INSERT INTO chosen_feed (youtube_id, title, kind, ref, published_at, hidden, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT(youtube_id) DO NOTHING`,
      ).bind(i.youtube_id, i.title, i.kind, i.ref, i.published_at, at),
    ),
  );
  return { added: res.reduce((s, r) => s + (r.meta.changes ?? 0), 0) };
}

chosenRoutes.get('/', async (c) => {
  // Se a tarefa automática ainda não rodou (ou está desligada), confere o feed em segundo plano.
  c.executionCtx.waitUntil(syncChosen(c.env).catch((e) => console.error('feed The Chosen', String(e))));
  const tipo = c.req.query('tipo');
  const kind = tipo === 'video' ? 'video' : tipo === 'todos' ? null : 'short';
  const { results } = await c.env.DB.prepare(
    `SELECT youtube_id, title, kind, ref, published_at FROM chosen_feed
     WHERE hidden = 0 ${kind ? 'AND kind = ?' : ''} ORDER BY published_at DESC LIMIT 60`,
  )
    .bind(...(kind ? [kind] : []))
    .all<FeedItem>();
  return c.json({ items: results });
});

chosenRoutes.post('/atualizar', async (c) => {
  needMedia(c);
  return c.json(await syncChosen(c.env, true));
});

chosenRoutes.post('/:yt{[A-Za-z0-9_-]{11}}/esconder', async (c) => {
  needMedia(c);
  const r = await c.env.DB.prepare('UPDATE chosen_feed SET hidden = 1 WHERE youtube_id = ?').bind(c.req.param('yt')).run();
  if (!r.meta.changes) fail(404, 'Vídeo não encontrado.');
  return c.json({ ok: true });
});
