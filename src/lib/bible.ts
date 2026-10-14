/** Bíblia: livros, versões, leitura dos arquivos, busca por palavra/frase e por referência ("jo 3:16"). */

export type VersionId = 'livre' | 'kjv' | 'kjvpt';

export const VERSIONS: Record<VersionId, { id: VersionId; short: string; name: string; lang: string }> = {
  livre: { id: 'livre', short: 'BLIVRE', name: 'Bíblia Livre', lang: 'pt-BR' },
  kjv: { id: 'kjv', short: 'KJV', name: 'King James 1769', lang: 'en' },
  kjvpt: { id: 'kjvpt', short: 'KJ-PT', name: 'King James em português (tradução IRN)', lang: 'pt-BR' },
};
export const VERSION_IDS = Object.keys(VERSIONS) as VersionId[];

/** Livros já traduzidos na King James em português (tradução IRN): números de 1 (Gênesis) a 66 (Apocalipse). */
export const KJVPT_BOOKS = new Set<number>([1, 2, 3, 4, 5, ...Array.from({ length: 27 }, (_, i) => 40 + i)]);
export const hasBook = (v: VersionId, n: number) => v !== 'kjvpt' || KJVPT_BOOKS.has(n);
export const MISSING_BOOK = 'Este livro ainda está sendo traduzido para a King James em português. Por enquanto, leia na Bíblia Livre (BLIVRE).';

export interface Book {
  n: number; // 1 a 66
  slug: string; // usado no endereço: /biblia/joao/3
  pt: string;
  en: string;
  abbr: string; // abreviação em português
  chapters: number;
  nt: boolean;
}

// nome em português | abreviação | nome em inglês | capítulos | outros apelidos aceitos na busca
const RAW = `Gênesis|Gn|Genesis|50|gen ge gên
Êxodo|Êx|Exodus|40|ex exo exod
Levítico|Lv|Leviticus|27|lev le
Números|Nm|Numbers|36|num nu
Deuteronômio|Dt|Deuteronomy|34|deut deu
Josué|Js|Joshua|24|josh jos
Juízes|Jz|Judges|21|judg jdg jui
Rute|Rt|Ruth|4|rut
1 Samuel|1Sm|1 Samuel|31|1sam 1sa 1s
2 Samuel|2Sm|2 Samuel|24|2sam 2sa 2s
1 Reis|1Rs|1 Kings|22|1kgs 1ki 1rei
2 Reis|2Rs|2 Kings|25|2kgs 2ki 2rei
1 Crônicas|1Cr|1 Chronicles|29|1chr 1ch 1cro
2 Crônicas|2Cr|2 Chronicles|36|2chr 2ch 2cro
Esdras|Ed|Ezra|10|esd ezr
Neemias|Ne|Nehemiah|13|neh nee
Ester|Et|Esther|10|est esth
Jó|Jó|Job|42|
Salmos|Sl|Psalms|150|salmo sal ps psa psalm
Provérbios|Pv|Proverbs|31|prov pro prv
Eclesiastes|Ec|Ecclesiastes|12|ecl eccl ecc
Cânticos|Ct|Song of Solomon|8|cantares canticodoscanticos cant song songofsongs sos
Isaías|Is|Isaiah|66|isa
Jeremias|Jr|Jeremiah|52|jer
Lamentações|Lm|Lamentations|5|lam
Ezequiel|Ez|Ezekiel|48|ezek eze
Daniel|Dn|Daniel|12|dan
Oseias|Os|Hosea|14|hos
Joel|Jl|Joel|3|
Amós|Am|Amos|9|
Obadias|Ob|Obadiah|1|obad oba abdias
Jonas|Jn|Jonah|4|jon
Miqueias|Mq|Micah|7|mic
Naum|Na|Nahum|3|nah
Habacuque|Hc|Habakkuk|3|hab
Sofonias|Sf|Zephaniah|3|zeph zep
Ageu|Ag|Haggai|2|hag
Zacarias|Zc|Zechariah|14|zech zec
Malaquias|Ml|Malachi|4|mal
Mateus|Mt|Matthew|28|mat matt
Marcos|Mc|Mark|16|mar mk mrk
Lucas|Lc|Luke|24|luc luk lk
João|Jo|John|21|jhn joh
Atos|At|Acts|28|act atosdosapostolos
Romanos|Rm|Romans|16|rom ro
1 Coríntios|1Co|1 Corinthians|16|1cor
2 Coríntios|2Co|2 Corinthians|13|2cor
Gálatas|Gl|Galatians|6|gal
Efésios|Ef|Ephesians|6|eph
Filipenses|Fp|Philippians|4|fl fil phil php
Colossenses|Cl|Colossians|4|col
1 Tessalonicenses|1Ts|1 Thessalonians|5|1tes 1thess 1th
2 Tessalonicenses|2Ts|2 Thessalonians|3|2tes 2thess 2th
1 Timóteo|1Tm|1 Timothy|6|1tim 1ti
2 Timóteo|2Tm|2 Timothy|4|2tim 2ti
Tito|Tt|Titus|3|tit
Filemom|Fm|Philemon|1|filemon flm phlm phm
Hebreus|Hb|Hebrews|13|heb
Tiago|Tg|James|5|jas jam tia
1 Pedro|1Pe|1 Peter|5|1pet 1pd 1pt
2 Pedro|2Pe|2 Peter|3|2pet 2pd 2pt
1 João|1Jo|1 John|5|1jn 1jhn 1joh
2 João|2Jo|2 John|1|2jn 2jhn 2joh
3 João|3Jo|3 John|1|3jn 3jhn 3joh
Judas|Jd|Jude|1|jud
Apocalipse|Ap|Revelation|22|apoc rev re revelations`;

/** Minúsculas e sem acentos (á → a, ç → c). Mantém o tamanho do texto, letra por letra. */
export function fold(s: string): string {
  let out = '';
  for (const ch of s) {
    const base = ch.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
    out += base.length === ch.length ? base : (base[0] ?? ' ').padEnd(ch.length, ' ').slice(0, ch.length);
  }
  return out;
}

/** Chave para comparar nomes de livros: sem acentos, espaços, pontos ou "º". */
const key = (s: string) => fold(s).replace(/[^a-z0-9]/g, '');

export const BOOKS: Book[] = RAW.split('\n').map((line, i) => {
  const [pt, abbr, en, ch] = line.split('|');
  return { n: i + 1, slug: key(pt).replace(/^(\d)/, '$1-'), pt, en, abbr, chapters: Number(ch), nt: i >= 39 };
});

// Apelidos. "jo" é João (como nas Bíblias em português); Jó só com acento ("jó") ou "job".
const EXACT = new Map<string, number>(); // com acento
const ALIAS = new Map<string, number>(); // sem acento
RAW.split('\n').forEach((line, i) => {
  const n = i + 1;
  const [pt, abbr, en, , extra] = line.split('|');
  const exact = (s: string) => EXACT.set(s.toLowerCase().replace(/[\s.º]/g, ''), n);
  const add = (s: string) => {
    const k = key(s);
    if (k && !ALIAS.has(k)) ALIAS.set(k, n);
  };
  exact(pt);
  exact(abbr);
  [pt, abbr, en, ...(extra ? extra.split(' ') : [])].forEach(add);
});
ALIAS.set('jo', 43);
ALIAS.set('jn', 32); // Jonas (em português)
ALIAS.set('job', 18);

export const bookByN = (n: number) => BOOKS[n - 1];

/** Acha o livro pelo nome, abreviação (português ou inglês), endereço ou número. */
export function findBook(input: string, allowPrefix = false): Book | null {
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return BOOKS[Number(raw) - 1] ?? null;
  raw = raw.replace(/^(iii|ii|i)(?=[\s.]|$)/, (r) => String(r.length)); // "II Reis" → "2 Reis"
  const exact = EXACT.get(raw.replace(/[\s.º-]/g, ''));
  if (exact) return BOOKS[exact - 1];
  const k = key(raw);
  if (!k) return null;
  const hit = ALIAS.get(k);
  if (hit) return BOOKS[hit - 1];
  if (allowPrefix && k.replace(/^\d/, '').length >= 2) {
    const found = BOOKS.find((b) => key(b.pt).startsWith(k) || key(b.en).startsWith(k));
    if (found) return found;
  }
  return null;
}

export interface Ref {
  book: Book;
  chapter: number;
  verse?: number;
  verseEnd?: number;
}

/**
 * Entende referências como "jo 3:16", "john 3:16", "João 3.16-18", "1 co 13", "sl 23", "Gênesis".
 * Só o nome do livro (sem capítulo) vale apenas se for exatamente um nome ou apelido conhecido.
 */
export function parseReference(input: string): Ref | null {
  const s = input.trim().replace(/\s+/g, ' ');
  const m = /^((?:[1-3]|i{1,3})?\s*\.?\s*[\p{L}][\p{L}\s.º]*?)\s*(\d+)?(?:\s*[:.,]\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/iu.exec(s);
  if (!m) return null;
  const [, name, ch, v1, v2] = m;
  const book = findBook(name, !!ch);
  if (!book) return null;
  if (!ch) return v1 ? null : { book, chapter: 1 };
  const chapter = Number(ch);
  if (chapter < 1 || chapter > book.chapters) return null;
  const ref: Ref = { book, chapter };
  if (v1) {
    ref.verse = Math.max(1, Number(v1));
    if (v2 && Number(v2) > ref.verse) ref.verseEnd = Number(v2);
  }
  return ref;
}

export const bookName = (b: Book, v: VersionId) => (v === 'kjv' ? b.en : b.pt);

/** "João 3:16", "João 3:16-18", "João 3:16,18". */
export function formatRef(b: Book, chapter: number, verses: number[], v: VersionId): string {
  const base = `${bookName(b, v)} ${chapter}`;
  if (!verses.length) return base;
  const sorted = [...new Set(verses)].sort((a, c) => a - c);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = start;
  for (const x of [...sorted.slice(1), Infinity]) {
    if (x === prev + 1) {
      prev = x;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = prev = x;
  }
  return `${base}:${parts.join(',')}`;
}

/** Texto sem marcações (na KJV, os [colchetes] das palavras acrescentadas saem). */
export const plain = (text: string, v: VersionId) => (v === 'kjv' ? text.replace(/[[\]]/g, '') : text);

/** Partes do versículo: na KJV o que está entre [colchetes] vem marcado para aparecer em itálico. */
export function segments(text: string, v: VersionId): { t: string; it: boolean }[] {
  if (v !== 'kjv') return [{ t: text, it: false }];
  return text
    .split(/(\[[^\]]*\])/)
    .filter(Boolean)
    .map((t) => (t.startsWith('[') && t.endsWith(']') ? { t: t.slice(1, -1), it: true } : { t, it: false }));
}

/** Texto para copiar/compartilhar. */
export function shareText(b: Book, chapter: number, verses: { n: number; text: string }[], v: VersionId): string {
  const body =
    verses.length === 1
      ? plain(verses[0].text, v)
      : verses
          .sort((a, c) => a.n - c.n)
          .map((x) => `${x.n} ${plain(x.text, v)}`)
          .join(' ');
  return `“${body}”\n— ${formatRef(b, chapter, verses.map((x) => x.n), v)} (${VERSIONS[v].short})`;
}

// ---------------- arquivos ----------------

export type BookData = string[][]; // capítulos → versículos

const loaded = new Map<string, Promise<BookData>>();

/** Lê um livro (public/biblia/<versão>/<n>.json). Sem internet, o service worker entrega os já abertos. */
export function loadBook(v: VersionId, n: number): Promise<BookData> {
  const k = `${v}/${n}`;
  let p = loaded.get(k);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        if (!hasBook(v, n)) throw new Error(MISSING_BOOK);
        res = await fetch(`/biblia/${k}.json`);
      } catch {
        throw new Error('Sem internet: este livro ainda não foi aberto neste aparelho.');
      }
      if (!res.ok || !res.headers.get('content-type')?.includes('json')) {
        throw new Error(res.status === 503 || res.status === 504 ? 'Sem internet: este livro ainda não foi aberto neste aparelho.' : 'Não foi possível abrir este livro.');
      }
      const data = (await res.json()) as { capitulos: BookData };
      return data.capitulos;
    })();
    p.catch(() => loaded.delete(k));
    loaded.set(k, p);
  }
  return p;
}

// ---------------- busca ----------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Palavras da busca, sem acentos e sem pontuação. */
export function queryWords(q: string): string[] {
  return fold(q)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Expressão que acha a palavra ou frase (palavras seguidas) no texto "dobrado" (sem acento, minúsculo e sem pontuação). */
export function matcher(q: string): RegExp | null {
  const words = queryWords(q);
  if (!words.length) return null;
  // Começo de palavra: "amou" acha "amou", mas não "chamou".
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRe).join(' +')}`, 'gu');
}

/** Texto dobrado com o mesmo tamanho do original (as posições batem para destacar o trecho). */
export const foldForSearch = (s: string) => fold(s).replace(/[^\p{L}\p{N}]/gu, ' ');

/** Trechos achados no texto: [início, fim). */
export function findRanges(text: string, re: RegExp): [number, number][] {
  const out: [number, number][] = [];
  const f = foldForSearch(text);
  re.lastIndex = 0;
  for (let m = re.exec(f); m; m = re.exec(f)) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

export interface Hit {
  book: Book;
  chapter: number;
  verse: number;
  text: string; // já sem marcações
  ranges: [number, number][];
}

export type Scope = 'todos' | 'at' | 'nt';

/**
 * Busca a palavra ou frase nos livros do escopo. Se a frase exata não aparecer em nenhum versículo, devolve os
 * versículos que têm todas as palavras (loose = true). Chama onProgress conforme os livros vão sendo lidos.
 */
export async function searchBible(
  v: VersionId,
  q: string,
  scope: Scope,
  onProgress?: (done: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<{ hits: Hit[]; loose: boolean; missing: number }> {
  const re = matcher(q);
  if (!re) return { hits: [], loose: false, missing: 0 };
  const words = queryWords(q);
  const each = words.length > 1 ? words.map((w) => matcher(w)!) : [];
  const books = BOOKS.filter((b) => (scope === 'todos' || (scope === 'nt') === b.nt) && hasBook(v, b.n));
  const exact: Hit[][] = [];
  const loose: Hit[][] = [];
  let done = 0;
  let missing = 0;
  let next = 0;
  const worker = async () => {
    while (next < books.length && !signal?.cancelled) {
      const i = next++;
      const b = books[i];
      const found: Hit[] = [];
      const near: Hit[] = [];
      try {
        const data = await loadBook(v, b.n);
        data.forEach((verses, ci) =>
          verses.forEach((raw, vi) => {
            const text = plain(raw, v);
            const ranges = findRanges(text, re);
            if (ranges.length) found.push({ book: b, chapter: ci + 1, verse: vi + 1, text, ranges });
            else if (each.length) {
              const all = each.map((w) => findRanges(text, w));
              if (all.every((r) => r.length)) {
                near.push({ book: b, chapter: ci + 1, verse: vi + 1, text, ranges: all.flat().sort((x, y) => x[0] - y[0]) });
              }
            }
          }),
        );
      } catch {
        missing++;
      }
      exact[i] = found;
      loose[i] = near;
      onProgress?.(++done, books.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  const hits = exact.flat();
  if (hits.length || !each.length) return { hits, loose: false, missing };
  return { hits: loose.flat(), loose: true, missing };
}

// ---------------- preferências do leitor (neste aparelho) ----------------

const LS = { version: 'irn-biblia-versao', size: 'irn-biblia-letra', last: 'irn-biblia-ultima' };

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function lsSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem armazenamento local */
  }
}

export const getVersion = (): VersionId => {
  const s = lsGet(LS.version);
  return s === 'kjv' || s === 'kjvpt' ? s : 'livre';
};
export const saveVersion = (v: VersionId) => lsSet(LS.version, v);

export const FONT_MIN = 14;
export const FONT_MAX = 28;
export const getFontSize = () => {
  const n = Number(lsGet(LS.size));
  return n >= FONT_MIN && n <= FONT_MAX ? n : 18;
};
export const saveFontSize = (n: number) => lsSet(LS.size, String(n));

export interface LastRead {
  book: number;
  chapter: number;
}
export function getLastRead(): LastRead | null {
  try {
    const r = JSON.parse(lsGet(LS.last) || 'null') as LastRead | null;
    if (r && bookByN(r.book) && r.chapter >= 1 && r.chapter <= bookByN(r.book).chapters) return r;
  } catch {
    /* ignora */
  }
  return null;
}
export const saveLastRead = (r: LastRead) => lsSet(LS.last, JSON.stringify(r));

export const chapterPath = (b: Book, chapter: number, verse?: number) => `/biblia/${b.slug}/${chapter}${verse ? `?v=${verse}` : ''}`;
