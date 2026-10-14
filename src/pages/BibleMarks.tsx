/** Marcar e anotar versículos, "Meus versículos" e arte de versículo para compartilhar. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Highlighter, ImageDown, Share2, StickyNote, Trash2, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { bookByN, bookName, chapterPath, formatRef, getVersion, loadBook, plain, VERSIONS, type Book, type VersionId } from '../lib/bible';
import { allMarks, getMark, MARK_COLORS, removeMark, setMarks, useMarksVersion, type MarkColor, type MarkEntry } from '../lib/marks';
import { ART_SIZES, ART_THEMES, downloadBlob, drawVerseArt, shareImage, type ArtFormat, type ArtTheme } from '../lib/verseArt';
import { Button, Chips, confirmDialog, Empty, Page, Seg, Sheet, Skeleton, TextField, toast, toastError } from '../components/ui';
import './Bible.css';

export const colorCss = (c?: MarkColor) => MARK_COLORS.find((x) => x.id === c)?.css;

// ---------------- marcar / anotar ----------------

export function MarkSheet({ book, chapter, verses, v, onClose }: { book: Book; chapter: number; verses: number[]; v: VersionId; onClose: () => void }) {
  const first = getMark(book.n, chapter, Math.min(...verses));
  const [note, setNote] = useState(verses.length === 1 ? first?.note ?? '' : '');
  const [color, setColor] = useState<MarkColor | undefined>(first?.c);
  const anyMarked = verses.some((n) => getMark(book.n, chapter, n));
  const ref = formatRef(book, chapter, verses, v);

  const pick = (c: MarkColor) => {
    setColor(c);
    setMarks(book.n, chapter, verses, { c });
  };

  return (
    <Sheet
      open
      title="Marcar e anotar"
      onClose={onClose}
      footer={
        <>
          {anyMarked && (
            <Button
              variant="ghost"
              icon={<Trash2 />}
              onClick={() => {
                setMarks(book.n, chapter, verses, { c: null, note: '' });
                toast('Marcação removida.', 'ok');
                onClose();
              }}
            >
              Tirar marcação
            </Button>
          )}
          <Button
            onClick={() => {
              if (note.trim() || verses.length === 1) setMarks(book.n, chapter, verses, { note });
              if (color || note.trim()) toast('Salvo em Meus versículos.', 'ok');
              onClose();
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <div style={{ fontWeight: 650 }}>{ref}</div>
        <div>
          <div className="small" style={{ fontWeight: 620, marginBottom: 8 }}>
            Cor do marca-texto
          </div>
          <div className="mark-colors" role="radiogroup" aria-label="Cor">
            {MARK_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={c.label}
                className={`mark-swatch ${color === c.id ? 'on' : ''}`}
                style={{ background: c.css }}
                onClick={() => pick(c.id)}
              />
            ))}
            {color && (
              <button
                type="button"
                className="mark-swatch none"
                aria-label="Sem cor"
                title="Sem cor"
                onClick={() => {
                  setColor(undefined);
                  setMarks(book.n, chapter, verses, { c: null });
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
        <TextField
          label={verses.length > 1 ? 'Anotação (vale para todos os versículos escolhidos)' : 'Minha anotação'}
          value={note}
          onChange={setNote}
          multiline
          rows={4}
          maxLength={2000}
          placeholder="O que Deus falou com você neste texto?"
        />
        <div className="tiny muted">As marcações e anotações ficam guardadas só neste aparelho.</div>
      </div>
    </Sheet>
  );
}

// ---------------- arte do versículo ----------------

export function VerseArtSheet({ text, reference, onClose }: { text: string; reference: string; onClose: () => void }) {
  const { church } = useSession();
  const [theme, setTheme] = useState<ArtTheme>(() => {
    try {
      return (localStorage.getItem('irn-arte-tema') as ArtTheme) || 'noite';
    } catch {
      return 'noite';
    }
  });
  const [format, setFormat] = useState<ArtFormat>('post');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    drawVerseArt({ text, reference, church: church.name, theme, format })
      .then((b) => {
        if (my !== seq.current) return;
        setBlob(b);
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(b);
        });
      })
      .catch(toastError)
      .finally(() => my === seq.current && setBusy(false));
    try {
      localStorage.setItem('irn-arte-tema', theme);
    } catch {
      /* ok */
    }
  }, [text, reference, church.name, theme, format]);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const filename = `${reference.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase() || 'versiculo'}.png`;
  const { w, h } = ART_SIZES[format];

  return (
    <Sheet
      open
      title="Versículo em imagem"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" icon={<Download />} disabled={!blob} onClick={() => blob && downloadBlob(blob, filename)}>
            Baixar
          </Button>
          <Button
            icon={<Share2 />}
            disabled={!blob}
            onClick={async () => {
              if (!blob) return;
              const r = await shareImage(blob, filename, `${reference} · ${church.short}`);
              if (r === 'downloaded') toast('Imagem baixada. Agora é só enviar no WhatsApp ou postar.', 'ok');
            }}
          >
            Compartilhar
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="art-preview" style={{ aspectRatio: `${w} / ${h}` }}>
          {url ? <img src={url} alt={`Arte: ${reference}`} style={{ opacity: busy ? 0.6 : 1 }} /> : <Skeleton h={320} r={14} />}
        </div>
        <Seg
          value={format}
          onChange={setFormat}
          options={(Object.keys(ART_SIZES) as ArtFormat[]).map((f) => ({ value: f, label: ART_SIZES[f].label }))}
        />
        <div className="mark-colors" role="radiogroup" aria-label="Fundo">
          {ART_THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={theme === t.id}
              aria-label={t.label}
              title={t.label}
              className={`mark-swatch ${theme === t.id ? 'on' : ''}`}
              style={{ background: `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})` }}
              onClick={() => setTheme(t.id)}
            />
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// ---------------- /biblia/marcados ----------------

export function MarkedVerses() {
  useMarksVersion();
  const marks = allMarks();
  const [filter, setFilter] = useState<'todos' | 'notas' | MarkColor>('todos');
  const [v] = useState<VersionId>(getVersion);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [art, setArt] = useState<{ text: string; reference: string } | null>(null);

  const books = useMemo(() => [...new Set(marks.map((m) => m.book))].sort((a, b) => a - b).join(','), [marks]);
  useEffect(() => {
    let alive = true;
    const ns = books ? books.split(',').map(Number) : [];
    void Promise.all(
      ns.map((n) =>
        loadBook(v, n)
          .then((d) => ({ n, d }))
          .catch(() => (v !== 'livre' ? loadBook('livre', n).then((d) => ({ n, d })) : null))
          .catch(() => null),
      ),
    ).then((list) => {
      if (!alive) return;
      const out: Record<string, string> = {};
      for (const it of list) {
        if (!it) continue;
        it.d.forEach((ch, ci) => ch.forEach((t, vi) => (out[`${it.n}:${ci + 1}:${vi + 1}`] = plain(t, v))));
      }
      setTexts(out);
    });
    return () => {
      alive = false;
    };
  }, [books, v]);

  const shown = marks.filter((m) => (filter === 'todos' ? true : filter === 'notas' ? !!m.note : m.c === filter));
  const usedColors = MARK_COLORS.filter((c) => marks.some((m) => m.c === c.id));

  return (
    <Page title="Meus versículos" back="/biblia">
      <div className="stack">
        {marks.length > 0 && (
          <Chips
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'todos', label: `Todos (${marks.length})` },
              ...(marks.some((m) => m.note) ? [{ value: 'notas' as const, label: 'Com anotação' }] : []),
              ...usedColors.map((c) => ({ value: c.id, label: c.label })),
            ]}
          />
        )}
        {shown.length ? (
          shown.map((m) => <MarkedCard key={`${m.book}:${m.chapter}:${m.verse}`} m={m} v={v} text={texts[`${m.book}:${m.chapter}:${m.verse}`]} onArt={setArt} />)
        ) : (
          <Empty
            icon={<Highlighter />}
            title={marks.length ? 'Nada com este filtro' : 'Nenhum versículo marcado'}
            text={
              marks.length
                ? undefined
                : 'Na leitura da Bíblia, toque em um versículo e use o marca-texto ou a anotação. Eles aparecem aqui.'
            }
            action={
              !marks.length && (
                <Link className="btn btn-primary" to="/biblia">
                  Abrir a Bíblia
                </Link>
              )
            }
          />
        )}
        {marks.length > 0 && <p className="tiny muted center">Guardados só neste aparelho. {VERSIONS[v].short}</p>}
      </div>
      {art && <VerseArtSheet text={art.text} reference={art.reference} onClose={() => setArt(null)} />}
    </Page>
  );
}

function MarkedCard({ m, v, text, onArt }: { m: MarkEntry; v: VersionId; text?: string; onArt: (a: { text: string; reference: string }) => void }) {
  const book = bookByN(m.book);
  const reference = formatRef(book, m.chapter, [m.verse], v);
  const [editing, setEditing] = useState(false);
  return (
    <article className="card card-pad stack marked-card" style={{ gap: 8, borderLeft: `5px solid ${colorCss(m.c) ?? 'var(--line-2)'}` }}>
      <div className="row">
        <Link to={chapterPath(book, m.chapter, m.verse)} className="grow" style={{ fontWeight: 680, color: 'var(--gold)' }}>
          {bookName(book, v)} {m.chapter}:{m.verse}
        </Link>
        {text && (
          <button className="icon-btn" aria-label="Fazer imagem" title="Versículo em imagem" onClick={() => onArt({ text, reference: `${reference} (${VERSIONS[v].short})` })}>
            <ImageDown size={19} />
          </button>
        )}
        <button className="icon-btn" aria-label="Editar anotação" onClick={() => setEditing(true)}>
          <StickyNote size={19} />
        </button>
        <button
          className="icon-btn"
          aria-label="Remover"
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Remover este versículo de Meus versículos?', confirmLabel: 'Remover', danger: true }))) return;
            removeMark(m.book, m.chapter, m.verse);
          }}
        >
          <Trash2 size={19} />
        </button>
      </div>
      {text ? (
        <p className="verse" style={{ fontSize: 16.5, background: m.c ? `${colorCss(m.c)}55` : undefined, borderRadius: 6 }}>
          {text}
        </p>
      ) : (
        <Skeleton h={22} r={6} />
      )}
      {m.note && (
        <div className="mark-note pre small">
          <StickyNote size={14} /> {m.note}
        </div>
      )}
      {editing && <MarkSheet book={book} chapter={m.chapter} verses={[m.verse]} v={v} onClose={() => setEditing(false)} />}
    </article>
  );
}
