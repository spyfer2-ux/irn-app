import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenText, Clapperboard, Play } from 'lucide-react';
import type { Scene } from '../lib/types';
import { useApi } from '../lib/api';
import { bookByN, chapterPath, formatRef, getVersion, hasBook, loadBook, parseReference, plain, VERSIONS, type Book, type VersionId } from '../lib/bible';
import { Skeleton, TextField } from './ui';

/** Passagem como a API recebe: { book, chapter, verse?, verseEnd? }. */
export interface PassageInput {
  book: number;
  chapter: number;
  verse?: number;
  verseEnd?: number;
}

export interface PassageFields {
  bible_book: number | null;
  bible_chapter: number | null;
  bible_verse: number | null;
  bible_verse_end: number | null;
}

export function verseList(start?: number | null, end?: number | null): number[] {
  if (!start) return [];
  const last = end && end > start ? end : start;
  return Array.from({ length: Math.min(last - start + 1, 200) }, (_, i) => start + i);
}

/** "João 4:1-26" a partir dos campos (ou '' se não tiver passagem). */
export function passageLabel(v: PassageFields): string {
  if (!v.bible_book || !v.bible_chapter) return '';
  return formatRef(bookByN(v.bible_book), v.bible_chapter, verseList(v.bible_verse, v.bible_verse_end), 'livre');
}

/** Lê o que a pessoa digitou ("jo 4:1-26"). Vazio → null. Inválido → 'erro'. */
export function readPassage(text: string): PassageInput | null | 'erro' {
  if (!text.trim()) return null;
  const r = parseReference(text);
  if (!r) return 'erro';
  return { book: r.book.n, chapter: r.chapter, verse: r.verse, verseEnd: r.verseEnd };
}

/** Campo "Passagem bíblica", mostrando como o app entendeu o que foi digitado. */
export function PassageField({ value, onChange, label = 'Passagem bíblica' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const p = readPassage(value);
  const hint =
    p === 'erro' ? (
      <span style={{ color: 'var(--danger)' }}>Não entendi a referência. Exemplos: jo 4:1-26, mt 14:22-33, lc 5.</span>
    ) : p ? (
      <span>
        Entendi: <strong>{formatRef(bookByN(p.book), p.chapter, verseList(p.verse, p.verseEnd), 'livre')}</strong>
      </span>
    ) : (
      'Ex.: jo 4:1-26 — o texto aparece junto da cena e a cena aparece no capítulo da Bíblia.'
    );
  return <TextField label={label} value={value} onChange={onChange} placeholder="jo 4:1-26" maxLength={40} hint={hint} />;
}

/** Texto da passagem, com botão para abrir direto na Bíblia do app. */
export function PassageCard({ v }: { v: PassageFields }) {
  const book: Book | null = v.bible_book ? bookByN(v.bible_book) : null;
  const chapter = v.bible_chapter ?? 1;
  const pref = getVersion();
  const version: VersionId = book && hasBook(pref, book.n) ? pref : 'livre';
  const [verses, setVerses] = useState<string[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!book) return;
    let alive = true;
    setFailed(false);
    loadBook(version, book.n)
      .then((d) => alive && setVerses(d[chapter - 1] ?? []))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [book?.n, chapter, version]);

  if (!book) return null;
  const wanted = verseList(v.bible_verse, v.bible_verse_end);
  const shown = verses ? (wanted.length ? wanted.filter((n) => n <= verses.length) : verses.map((_, i) => i + 1)) : [];
  const label = formatRef(book, chapter, wanted, 'livre');

  return (
    <section className="card card-pad passage-card" aria-label={`Passagem bíblica: ${label}`}>
      <div className="passage-head">
        <span className="icon-tile gold">
          <BookOpenText size={18} />
        </span>
        <div className="grow">
          <div className="tiny muted" style={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Na Bíblia
          </div>
          <div style={{ fontWeight: 700 }}>{label}</div>
        </div>
      </div>
      {failed ? (
        <p className="small muted">Não consegui carregar o texto agora. Toque em "Ler na Bíblia".</p>
      ) : !verses ? (
        <div className="stack" style={{ gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} h={18} r={6} />
          ))}
        </div>
      ) : (
        <div className="passage-text" lang={VERSIONS[version].lang}>
          {shown.map((n) => (
            <span key={n}>
              <sup>{n}</sup>
              {plain(verses[n - 1], version)}{' '}
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="tiny muted">{VERSIONS[version].name}</span>
        <Link className="btn btn-secondary btn-sm" to={chapterPath(book, chapter, wanted[0])}>
          <BookOpenText size={16} /> Ler na Bíblia
        </Link>
      </div>
    </section>
  );
}

export const sceneThumb = (s: Pick<Scene, 'youtube_id'>) => `https://i.ytimg.com/vi/${s.youtube_id}/hqdefault.jpg`;

/** "1:05" / "1:02:03". */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function SceneCard({ s }: { s: Scene }) {
  return (
    <Link to={`/cenas/${s.id}`} className="video-card">
      <div className="thumb">
        <img src={sceneThumb(s)} alt="" loading="lazy" referrerPolicy="no-referrer" />
        <div className="play">
          <span>
            <Play size={20} fill="currentColor" />
          </span>
        </div>
        {s.end_s ? <span className="dur">{clock(s.end_s - s.start_s)}</span> : null}
      </div>
      <div className="vt clamp-2">{s.title}</div>
      <div className="video-ref">
        <BookOpenText size={13} /> {passageLabel(s)}
      </div>
      {s.episode && <div className="tiny muted mt-1 ellipsis">{s.episode}</div>}
    </Link>
  );
}

/** No capítulo da Bíblia: cenas ligadas a ele. */
export function ChapterScenes({ book, chapter }: { book: Book; chapter: number }) {
  const { data } = useApi<{ scenes: Scene[] }>(`/cenas?livro=${book.n}&cap=${chapter}`);
  const list = data?.scenes ?? [];
  if (!list.length) return null;
  return (
    <section className="stack" aria-label="Cenas sobre este capítulo">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <Clapperboard size={18} />
        <h2 style={{ fontSize: 17, margin: 0 }}>Cenas que pregam</h2>
      </div>
      <div className="video-grid">
        {list.map((s) => (
          <SceneCard key={s.id} s={s} />
        ))}
      </div>
    </section>
  );
}
