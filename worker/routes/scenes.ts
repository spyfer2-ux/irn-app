/**
 * "Cenas que pregam": trechos dos vídeos oficiais da série The Chosen no YouTube, ligados a uma passagem da Bíblia,
 * com um texto curto do pastor e perguntas para a célula e a família.
 *
 * O app NÃO guarda, baixa nem recorta os vídeos: só guarda o código do vídeo e os segundos de início e fim,
 * e quem toca é o player do próprio YouTube (parâmetros start/end).
 */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { body, fail, int, needMedia, now, oneOf, reqStr, str, visibleSet } from '../util';
import { oembed, youtubeId } from './videos';

export const sceneRoutes = new Hono<AppEnv>();

/** Capítulos de cada livro (1 = Gênesis … 66 = Apocalipse), para conferir a passagem. */
export const CHAPTERS = [
  50, 40, 27, 36, 34, 24, 21, 4, 31, 24, 22, 25, 29, 36, 10, 13, 10, 42, 150, 31, 12, 8, 66, 52, 5, 48, 12, 14, 3, 9, 1, 4, 7, 3, 3, 3, 2, 14, 4,
  28, 16, 24, 21, 28, 16, 16, 13, 6, 6, 4, 4, 5, 3, 6, 4, 3, 1, 13, 5, 5, 3, 5, 1, 1, 1, 22,
];

const MAX_S = 6 * 3600;

interface Row {
  questions: string;
  visibility: string;
  [k: string]: unknown;
}
const out = (r: Row) => {
  let q: unknown = [];
  try {
    q = JSON.parse(r.questions);
  } catch {
    /* lista vazia */
  }
  return { ...r, questions: Array.isArray(q) ? q : [] };
};

export function readScene(b: Record<string, unknown>) {
  const yt = youtubeId(reqStr(b.youtube, 300, 'o link do vídeo no YouTube'));
  if (!yt) fail(400, 'Não reconheci este link do YouTube. Copie pelo botão "Compartilhar" do vídeo.');
  const start = int(b.start_s, 0, MAX_S, 'início do trecho') ?? 0;
  let end = int(b.end_s, 1, MAX_S, 'fim do trecho');
  if (end !== null && end <= start) fail(400, 'O fim do trecho precisa ser depois do início.');
  const p = (b.passage ?? {}) as Record<string, unknown>;
  if (typeof p !== 'object') fail(400, 'Passagem bíblica inválida.');
  const book = int(p.book, 1, 66, 'livro da Bíblia') ?? fail(400, 'Diga a passagem bíblica da cena (ex.: jo 4:1-26).');
  const chapter = int(p.chapter, 1, CHAPTERS[book - 1], 'capítulo') ?? fail(400, 'Diga o capítulo da passagem.');
  const verse = int(p.verse, 1, 176, 'versículo');
  let verseEnd = verse ? int(p.verseEnd, 1, 176, 'versículo final') : null;
  if (verseEnd !== null && verse !== null && verseEnd <= verse) verseEnd = null;
  const qs = Array.isArray(b.questions) ? b.questions : [];
  const questions = qs
    .map((x, i) => str(x, 300, { label: `pergunta ${i + 1}` }))
    .filter((x): x is string => !!x)
    .slice(0, 5);
  end ??= null;
  return {
    youtube_id: yt,
    start_s: start,
    end_s: end,
    title: reqStr(b.title, 140, 'o título da cena'),
    episode: str(b.episode, 80, { label: 'episódio' }),
    bible_book: book,
    bible_chapter: chapter,
    bible_verse: verse,
    bible_verse_end: verseEnd,
    pastor_text: str(b.pastor_text, 3000, { label: 'texto do pastor' }),
    questions: JSON.stringify(questions),
    visibility: oneOf(b.visibility ?? 'public', ['public', 'members'] as const, 'visibilidade'),
  };
}

sceneRoutes.get('/', async (c) => {
  const vis = visibleSet(c.get('user'));
  const conds = [`visibility IN (${vis.map(() => '?').join(',')})`];
  const binds: unknown[] = [...vis];
  const livro = int(c.req.query('livro'), 1, 66, 'livro');
  if (livro) {
    conds.push('bible_book = ?');
    binds.push(livro);
    const cap = int(c.req.query('cap'), 1, 150, 'capítulo');
    if (cap) {
      conds.push('bible_chapter = ?');
      binds.push(cap);
    }
  }
  const q = str(c.req.query('q'), 80, { label: 'busca' });
  if (q) {
    conds.push("(title LIKE ? ESCAPE '\\' OR episode LIKE ? ESCAPE '\\' OR pastor_text LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    binds.push(like, like, like);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM scenes WHERE ${conds.join(' AND ')} ORDER BY bible_book, bible_chapter, COALESCE(bible_verse, 0), id LIMIT 200`,
  )
    .bind(...binds)
    .all<Row>();
  return c.json({ scenes: results.map(out) });
});

sceneRoutes.get('/:id{[0-9]+}', async (c) => {
  const r = await c.env.DB.prepare('SELECT * FROM scenes WHERE id = ?').bind(Number(c.req.param('id'))).first<Row>();
  if (!r || !visibleSet(c.get('user')).includes(r.visibility)) fail(404, 'Cena não encontrada.');
  return c.json({ scene: out(r) });
});

/** Confere no YouTube se o vídeo existe e pode ser tocado fora do YouTube, e de qual canal ele é. */
async function channelOf(id: string): Promise<string | null> {
  const info = await oembed(id);
  if (!info) fail(400, 'Este vídeo não existe, é privado ou o canal não deixa tocar fora do YouTube.');
  return info.author_name?.slice(0, 100) ?? null;
}

sceneRoutes.post('/', async (c) => {
  const u = needMedia(c);
  const s = readScene(await body(c));
  const channel = await channelOf(s.youtube_id);
  const t = now();
  const row = await c.env.DB.prepare(
    `INSERT INTO scenes (youtube_id, start_s, end_s, title, episode, channel, bible_book, bible_chapter, bible_verse, bible_verse_end,
       pastor_text, questions, visibility, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      s.youtube_id,
      s.start_s,
      s.end_s,
      s.title,
      s.episode,
      channel,
      s.bible_book,
      s.bible_chapter,
      s.bible_verse,
      s.bible_verse_end,
      s.pastor_text,
      s.questions,
      s.visibility,
      u.id,
      t,
      t,
    )
    .first<{ id: number }>();
  return c.json({ id: row!.id, channel });
});

sceneRoutes.put('/:id{[0-9]+}', async (c) => {
  needMedia(c);
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT youtube_id, channel FROM scenes WHERE id = ?')
    .bind(id)
    .first<{ youtube_id: string; channel: string | null }>();
  if (!old) fail(404, 'Cena não encontrada.');
  const s = readScene(await body(c));
  const channel = s.youtube_id === old.youtube_id ? old.channel : await channelOf(s.youtube_id);
  await c.env.DB.prepare(
    `UPDATE scenes SET youtube_id = ?, start_s = ?, end_s = ?, title = ?, episode = ?, channel = ?, bible_book = ?, bible_chapter = ?,
       bible_verse = ?, bible_verse_end = ?, pastor_text = ?, questions = ?, visibility = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      s.youtube_id,
      s.start_s,
      s.end_s,
      s.title,
      s.episode,
      channel,
      s.bible_book,
      s.bible_chapter,
      s.bible_verse,
      s.bible_verse_end,
      s.pastor_text,
      s.questions,
      s.visibility,
      now(),
      id,
    )
    .run();
  return c.json({ ok: true, channel });
});

sceneRoutes.delete('/:id{[0-9]+}', async (c) => {
  needMedia(c);
  await c.env.DB.prepare('DELETE FROM scenes WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});
