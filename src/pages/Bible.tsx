/** Bíblia: leitura por livro e capítulo (Bíblia Livre e King James), busca por palavra, frase ou referência. */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ALargeSmall, ArrowLeft, BookOpenText, ChevronDown, ChevronLeft, ChevronRight, Copy, MessageCircle, Search, X } from 'lucide-react';
import {
  BOOKS,
  bookByN,
  bookName,
  chapterPath,
  findBook,
  FONT_MAX,
  FONT_MIN,
  formatRef,
  getFontSize,
  getLastRead,
  getVersion,
  loadBook,
  parseReference,
  saveFontSize,
  saveLastRead,
  saveVersion,
  searchBible,
  segments,
  shareText,
  VERSIONS,
  type Book,
  type BookData,
  type Hit,
  type Scope,
  type VersionId,
} from '../lib/bible';
import { Button, Chips, Empty, ErrorBox, Page, Seg, Sheet, Skeleton, toast } from '../components/ui';
import './Bible.css';
import { ArtShortcut, ChapterArt } from './BibleArt';
import { KjaLink } from './BibleKja';

// ---------------- versão escolhida (igual em todas as telas) ----------------

let currentVersion: VersionId = getVersion();
const versionListeners = new Set<(v: VersionId) => void>();

function useBibleVersion(): [VersionId, (v: VersionId) => void] {
  const [v, setV] = useState(currentVersion);
  useEffect(() => {
    versionListeners.add(setV);
    return () => {
      versionListeners.delete(setV);
    };
  }, []);
  const change = (next: VersionId) => {
    currentVersion = next;
    saveVersion(next);
    versionListeners.forEach((f) => f(next));
  };
  return [v, change];
}

function VersionSwitch() {
  const [v, setV] = useBibleVersion();
  return (
    <div className="bible-version" title="Trocar a versão da Bíblia">
      <Seg value={v} onChange={setV} options={[{ value: 'livre', label: 'BLIVRE' }, { value: 'kjv', label: 'KJV' }, { value: 'kjvpt', label: 'KJ-PT' }]} />
    </div>
  );
}

function Credit({ v }: { v: VersionId }) {
  if (v === 'kjvpt')
    return (
      <p className="bible-credit">
        <strong>King James em português (tradução IRN)</strong>: tradução própria do Ministério Profético Restaurando Nações, feita com ajuda de
        inteligência artificial a partir da King James Version de 1769 (domínio público). Não é a King James Atualizada (KJA) nem outra
        tradução publicada. Por enquanto, só o Novo Testamento. Encontrou um erro? Avise a liderança.
      </p>
    );
  return v === 'livre' ? (
    <p className="bible-credit">
      <strong>Bíblia Livre (BLIVRE)</strong>, Copyright © Diego Santos, Mario Sérgio e Marco Teles,{' '}
      <a href="http://sites.google.com/site/biblialivre/" target="_blank" rel="noopener noreferrer">
        sites.google.com/site/biblialivre
      </a>{' '}
      — fevereiro de 2018. Licença{' '}
      <a href="https://creativecommons.org/licenses/by/4.0/deed.pt-br" target="_blank" rel="noopener noreferrer">
        Creative Commons Atribuição 4.0
      </a>
      . Texto obtido em{' '}
      <a href="https://ebible.org/" target="_blank" rel="noopener noreferrer">
        eBible.org
      </a>
      .
    </p>
  ) : (
    <p className="bible-credit">
      <strong>King James Version (KJV)</strong>, texto de 1769, domínio público. Palavras em itálico foram acrescentadas pelos tradutores. Texto
      obtido em{' '}
      <a href="https://ebible.org/" target="_blank" rel="noopener noreferrer">
        eBible.org
      </a>
      .
    </p>
  );
}

// ---------------- copiar e compartilhar ----------------

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Versículo copiado!', 'ok');
}

function shareWhatsApp(text: string) {
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}

// ---------------- escolher livro e capítulo ----------------

function BookPicker({ v, current, onClose }: { v: VersionId; current?: Book; onClose: () => void }) {
  const navigate = useNavigate();
  const [book, setBook] = useState<Book | null>(null);
  const [testament, setTestament] = useState<'at' | 'nt'>(current?.nt ? 'nt' : 'at');
  const go = (b: Book, c: number) => {
    onClose();
    navigate(chapterPath(b, c));
  };
  return (
    <Sheet open title={book ? bookName(book, v) : 'Escolha o livro'} onClose={onClose}>
      {book ? (
        <div className="stack">
          <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setBook(null)}>
            ‹ Todos os livros
          </button>
          <div className="bible-grid chapters">
            {Array.from({ length: book.chapters }, (_, i) => (
              <button key={i} className="bible-cell" onClick={() => go(book, i + 1)}>
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack">
          <Seg
            value={testament}
            onChange={setTestament}
            options={[
              { value: 'at', label: 'Antigo Testamento' },
              { value: 'nt', label: 'Novo Testamento' },
            ]}
          />
          <div className="bible-grid books">
            {BOOKS.filter((b) => b.nt === (testament === 'nt')).map((b) => (
              <button
                key={b.n}
                className={`bible-cell book ${current?.n === b.n ? 'on' : ''}`}
                onClick={() => (b.chapters === 1 ? go(b, 1) : setBook(b))}
              >
                {bookName(b, v)}
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ---------------- atalho para a tela de Início ----------------

export function BibleShortcut() {
  const last = getLastRead();
  const b = last ? bookByN(last.book) : null;
  return (
    <Link to={b && last ? chapterPath(b, last.chapter) : '/biblia'} className="card card-pad card-link row">
      <div className="icon-tile gold">
        <BookOpenText />
      </div>
      <div className="grow">
        <div style={{ fontWeight: 650 }}>Bíblia</div>
        <div className="small muted">
          {b && last ? `Continuar a leitura: ${b.pt} ${last.chapter}` : 'Leia e pesquise a Palavra — Bíblia Livre e King James'}
        </div>
      </div>
      <ChevronRight className="chev" />
    </Link>
  );
}

// ---------------- /biblia: início, livros e busca ----------------

const PAGE = 100;

function Highlight({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    at = b;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}

export default function BiblePage() {
  const [v] = useBibleVersion();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const scope = (['at', 'nt'].includes(params.get('t') ?? '') ? params.get('t') : 'todos') as Scope;
  const [input, setInput] = useState(q);
  const [picker, setPicker] = useState<Book | null | false>(false);
  const [state, setState] = useState<{ hits: Hit[]; loose: boolean; missing: number } | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const last = getLastRead();
  const lastBook = last ? bookByN(last.book) : null;
  const ref = useMemo(() => (q ? parseReference(q) : null), [q]);
  const navigate = useNavigate();

  useEffect(() => setInput(q), [q]);

  useEffect(() => {
    setState(null);
    setShown(PAGE);
    // Referência com capítulo (ex.: "jo 3:16") não precisa procurar no texto.
    if (!q.trim() || (ref && /\d/.test(q))) return;
    const signal = { cancelled: false };
    setProgress([0, 1]);
    void searchBible(v, q, scope, (d, t) => !signal.cancelled && setProgress([d, t]), signal).then((r) => {
      if (signal.cancelled) return;
      setState(r);
      setProgress(null);
    });
    return () => {
      signal.cancelled = true;
    };
  }, [q, scope, v, ref]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    const r = parseReference(text);
    if (r && /\d/.test(text)) {
      navigate(chapterPath(r.book, r.chapter, r.verse) + (r.verseEnd ? `-${r.verseEnd}` : ''));
      return;
    }
    const next = new URLSearchParams(params);
    if (text) next.set('q', text);
    else next.delete('q');
    setParams(next);
  };

  const setScope = (s: Scope) => {
    const next = new URLSearchParams(params);
    if (s === 'todos') next.delete('t');
    else next.set('t', s);
    setParams(next, { replace: true });
  };

  return (
    <Page title="Bíblia" back="/" actions={<VersionSwitch />}>
      <div className="stack-lg">
        <form className="bible-search" onSubmit={submit} role="search">
          <Search className="ico" aria-hidden />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Palavra, frase ou jo 3:16"
            aria-label="Buscar na Bíblia"
          />
          {input && (
            <button
              type="button"
              className="icon-btn clear"
              aria-label="Limpar busca"
              onClick={() => {
                setInput('');
                const next = new URLSearchParams(params);
                next.delete('q');
                setParams(next);
              }}
            >
              <X />
            </button>
          )}
        </form>

        {q ? (
          <div className="stack">
            <Chips
              value={scope}
              onChange={setScope}
              options={[
                { value: 'todos', label: 'Toda a Bíblia' },
                { value: 'at', label: 'Antigo Testamento' },
                { value: 'nt', label: 'Novo Testamento' },
              ]}
            />
            {ref && (
              <Link to={chapterPath(ref.book, ref.chapter, ref.verse) + (ref.verseEnd ? `-${ref.verseEnd}` : '')} className="card card-pad card-link row">
                <div className="icon-tile gold">
                  <BookOpenText />
                </div>
                <div className="grow" style={{ fontWeight: 650 }}>
                  Abrir {formatRef(ref.book, ref.chapter, ref.verse ? [ref.verse] : [], v)}
                  {ref.verseEnd ? `-${ref.verseEnd}` : ''}
                </div>
                <ChevronRight className="chev" />
              </Link>
            )}
            {progress && (
              <div className="stack" style={{ gap: 8 }}>
                <div className="small muted">
                  Procurando… {progress[0]} de {progress[1]} livros
                </div>
                <div className="progress gold">
                  <div style={{ width: `${Math.round((progress[0] / Math.max(1, progress[1])) * 100)}%` }} />
                </div>
              </div>
            )}
            {state && state.missing > 0 && (
              <div className="alert warn small">
                {state.missing} livro(s) não puderam ser lidos sem internet. Os resultados abaixo são dos livros já abertos neste aparelho.
              </div>
            )}
            {state && !state.hits.length && !ref && (
              <Empty icon={<Search />} title="Nada encontrado" text={`Nenhum versículo com “${q}” na ${VERSIONS[v].name}. Tente outra palavra ou a outra versão.`} />
            )}
            {state && state.hits.length > 0 && (
              <>
                <div className="small muted">
                  {state.loose && `A frase exata não aparece; estes versículos têm todas as palavras. `}
                  {state.hits.length} {state.hits.length === 1 ? 'versículo encontrado' : 'versículos encontrados'} na {VERSIONS[v].name}
                </div>
                <div className="card">
                  <div className="list">
                    {state.hits.slice(0, shown).map((h) => (
                      <Link key={`${h.book.n}-${h.chapter}-${h.verse}`} to={chapterPath(h.book, h.chapter, h.verse)} className="list-item bible-hit">
                        <div className="grow">
                          <div className="small" style={{ fontWeight: 650, color: 'var(--gold)' }}>
                            {formatRef(h.book, h.chapter, [h.verse], v)}
                          </div>
                          <div className="bible-hit-text" lang={VERSIONS[v].lang}>
                            <Highlight text={h.text} ranges={h.ranges} />
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
                {state.hits.length > shown && (
                  <Button variant="secondary" onClick={() => setShown((s) => s + PAGE)}>
                    Mostrar mais ({state.hits.length - shown})
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <>
            {lastBook && last && (
              <Link to={chapterPath(lastBook, last.chapter)} className="word-card">
                <div className="kicker">Continuar a leitura</div>
                <h3>
                  {bookName(lastBook, v)} {last.chapter}
                </h3>
              </Link>
            )}
            <ArtShortcut v={v} />
            {(['at', 'nt'] as const).map((t) => (
              <section key={t}>
                <div className="section-title">
                  <h2>{t === 'at' ? 'Antigo Testamento' : 'Novo Testamento'}</h2>
                </div>
                <div className="bible-grid books">
                  {BOOKS.filter((b) => b.nt === (t === 'nt')).map((b) => (
                    <button key={b.n} className="bible-cell book" onClick={() => (b.chapters === 1 ? navigate(chapterPath(b, 1)) : setPicker(b))}>
                      {bookName(b, v)}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
        <Credit v={v} />
      </div>
      {picker !== false && <ChapterSheet book={picker} v={v} onClose={() => setPicker(false)} />}
    </Page>
  );
}

function ChapterSheet({ book, v, onClose }: { book: Book | null; v: VersionId; onClose: () => void }) {
  const navigate = useNavigate();
  if (!book) return <BookPicker v={v} onClose={onClose} />;
  return (
    <Sheet open title={bookName(book, v)} onClose={onClose}>
      <div className="bible-grid chapters">
        {Array.from({ length: book.chapters }, (_, i) => (
          <button
            key={i}
            className="bible-cell"
            onClick={() => {
              onClose();
              navigate(chapterPath(book, i + 1));
            }}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

// ---------------- /biblia/:livro/:cap: leitura ----------------

function parseVerseParam(s: string | null): number[] {
  if (!s) return [];
  const m = /^(\d+)(?:-(\d+))?$/.exec(s);
  if (!m) return [];
  const a = Number(m[1]);
  const b = Math.min(Number(m[2] ?? a), a + 200);
  return Array.from({ length: Math.max(1, b - a + 1) }, (_, i) => a + i);
}

export function BibleChapter() {
  const { livro = '', cap = '1' } = useParams();
  const [params] = useSearchParams();
  const book = findBook(livro);
  const chapter = Number(cap);
  if (!book || !Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) {
    const r = parseReference(`${livro} ${cap}`);
    return <Navigate to={r ? chapterPath(r.book, r.chapter) : '/biblia'} replace />;
  }
  if (livro !== book.slug) return <Navigate to={chapterPath(book, chapter) + (params.get('v') ? `?v=${params.get('v')}` : '')} replace />;
  return <Reader key={`${book.n}-${chapter}`} book={book} chapter={chapter} focus={parseVerseParam(params.get('v'))} />;
}

function Reader({ book, chapter, focus }: { book: Book; chapter: number; focus: number[] }) {
  const [v] = useBibleVersion();
  const navigate = useNavigate();
  const [data, setData] = useState<{ v: VersionId; book: BookData } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [size, setSize] = useState(getFontSize);
  const [showSize, setShowSize] = useState(false);
  const [picker, setPicker] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scrolled = useRef(false);

  const prev = chapter > 1 ? { b: book, c: chapter - 1 } : book.n > 1 ? { b: bookByN(book.n - 1), c: bookByN(book.n - 1).chapters } : null;
  const next = chapter < book.chapters ? { b: book, c: chapter + 1 } : book.n < 66 ? { b: bookByN(book.n + 1), c: 1 } : null;

  useEffect(() => {
    document.title = `${bookName(book, v)} ${chapter} · Bíblia · IRN`;
    saveLastRead({ book: book.n, chapter });
  }, [book, chapter, v]);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadBook(v, book.n)
      .then((d) => alive && setData({ v, book: d }))
      .catch((e) => alive && setError(e));
    // Já deixa o próximo capítulo guardado (para ler sem internet).
    if (next && next.b.n !== book.n) void loadBook(v, next.b.n).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [v, book.n, attempt]);

  useEffect(() => {
    if (!data || scrolled.current || !focus.length) return;
    scrolled.current = true;
    setTimeout(() => document.getElementById(`v${focus[0]}`)?.scrollIntoView({ block: 'center' }), 60);
  }, [data, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (document.querySelector('.backdrop')) return;
      if (e.key === 'ArrowLeft' && prev) navigate(chapterPath(prev.b, prev.c));
      if (e.key === 'ArrowRight' && next) navigate(chapterPath(next.b, next.c));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, navigate]);

  const verses = data && data.v === v ? (data.book[chapter - 1] ?? []) : null;
  const changeSize = (d: number) => {
    const n = Math.min(FONT_MAX, Math.max(FONT_MIN, size + d));
    setSize(n);
    saveFontSize(n);
  };
  const toggle = (n: number) => setSelected((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
  const selText = () => (verses ? shareText(book, chapter, selected.map((n) => ({ n, text: verses[n - 1] })), v) : '');
  const link = () => `${location.origin}${chapterPath(book, chapter, [...selected].sort((a, b) => a - b)[0])}`;

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <button className="icon-btn" onClick={() => navigate('/biblia')} aria-label="Voltar para a Bíblia" style={{ marginLeft: -8 }}>
            <ArrowLeft />
          </button>
          <button className="bible-title" onClick={() => setPicker(true)} aria-label="Escolher livro e capítulo">
            <span className="ellipsis">
              {bookName(book, v)} {chapter}
            </span>
            <ChevronDown size={18} />
          </button>
          <VersionSwitch />
          <button className={`icon-btn ${showSize ? 'on' : ''}`} onClick={() => setShowSize((s) => !s)} aria-label="Tamanho da letra" aria-expanded={showSize}>
            <ALargeSmall />
          </button>
        </div>
        {showSize && (
          <div className="wrap bible-size">
            <button className="btn btn-secondary btn-sm" onClick={() => changeSize(-1)} disabled={size <= FONT_MIN} aria-label="Diminuir letra">
              A−
            </button>
            <input
              type="range"
              min={FONT_MIN}
              max={FONT_MAX}
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                saveFontSize(Number(e.target.value));
              }}
              aria-label="Tamanho da letra"
              className="grow"
            />
            <button className="btn btn-secondary btn-sm" onClick={() => changeSize(1)} disabled={size >= FONT_MAX} aria-label="Aumentar letra" style={{ fontSize: 17 }}>
              A+
            </button>
          </div>
        )}
      </header>

      <main className="wrap page">
        <div className="stack-lg">
          <div>
            <div className="kicker bible-kicker">{VERSIONS[v].name}</div>
            <h1 className="bible-h1">
              {bookName(book, v)} {chapter}
            </h1>
          </div>

          <ChapterArt book={book} chapter={chapter} v={v} />
          {error ? (
            <ErrorBox error={error} retry={() => setAttempt((a) => a + 1)} />
          ) : !verses ? (
            <div className="stack">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} h={22} r={6} />
              ))}
            </div>
          ) : (
            <div className="bible-text" style={{ fontSize: size }} lang={VERSIONS[v].lang}>
              {verses.map((text, i) => {
                const n = i + 1;
                return (
                  <span
                    key={n}
                    id={`v${n}`}
                    className={`bv ${selected.includes(n) ? 'sel' : ''} ${focus.includes(n) ? 'focus' : ''}`}
                    onClick={() => toggle(n)}
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected.includes(n)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(n))}
                  >
                    <sup>{n}</sup>
                    {segments(text, v).map((s, j) => (s.it ? <em key={j}>{s.t}</em> : <span key={j}>{s.t}</span>))}{' '}
                  </span>
                );
              })}
            </div>
          )}

          {verses && <p className="tiny muted center">Toque nos versículos para copiar ou compartilhar.</p>}

          {verses && <KjaLink book={book} chapter={chapter} verse={selected.length ? Math.min(...selected) : focus[0]} />}
          <div className="row bible-nav">
            {prev ? (
              <Link className="btn btn-secondary grow" to={chapterPath(prev.b, prev.c)}>
                <ChevronLeft /> <span className="ellipsis">{prev.b === book ? `Capítulo ${prev.c}` : `${bookName(prev.b, v)} ${prev.c}`}</span>
              </Link>
            ) : (
              <span className="grow" />
            )}
            {next ? (
              <Link className="btn btn-secondary grow" to={chapterPath(next.b, next.c)}>
                <span className="ellipsis">{next.b === book ? `Capítulo ${next.c}` : `${bookName(next.b, v)} ${next.c}`}</span> <ChevronRight />
              </Link>
            ) : (
              <span className="grow" />
            )}
          </div>

          <Credit v={v} />
        </div>
      </main>

      {selected.length > 0 && verses && (
        <div className="bible-actions" role="toolbar" aria-label="Versículos escolhidos">
          <div className="bible-actions-in">
            <div className="grow ellipsis" style={{ fontWeight: 650 }}>
              {formatRef(book, chapter, selected, v)}
            </div>
            <button className="icon-btn" aria-label="Copiar" onClick={() => void copyText(selText())}>
              <Copy />
            </button>
            <button className="icon-btn whats" aria-label="Compartilhar no WhatsApp" onClick={() => shareWhatsApp(`${selText()}\n${link()}`)}>
              <MessageCircle />
            </button>
            <button className="icon-btn" aria-label="Limpar seleção" onClick={() => setSelected([])}>
              <X />
            </button>
          </div>
        </div>
      )}

      {picker && <BookPicker v={v} current={book} onClose={() => setPicker(false)} />}
    </>
  );
}
