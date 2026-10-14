/**
 * "Novidades de The Chosen": fileira de Shorts do canal oficial e um visualizador em tela cheia, no estilo reels
 * (arrasta para cima para o próximo). Quem toca é o player do YouTube; o app só guarda o código do vídeo.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { BookOpenText, ChevronDown, ChevronUp, Clapperboard, EyeOff, Play, Share2, Sparkles, X } from 'lucide-react';
import { api, useApi } from '../lib/api';
import { useSession } from '../lib/session';
import { share } from '../lib/ics';
import { chapterPath, formatRef, parseReference } from '../lib/bible';
import { toast, toastError } from './ui';
import { verseList } from './Passage';

export interface ChosenItem {
  youtube_id: string;
  title: string;
  kind: 'short' | 'video';
  ref: string | null;
  published_at: number;
}

/** Referência do Short já entendida pela Bíblia do app (ou null). */
export function chosenRef(it: Pick<ChosenItem, 'ref'>) {
  if (!it.ref) return null;
  const r = parseReference(it.ref);
  if (!r) return null;
  return { ...r, label: formatRef(r.book, r.chapter, verseList(r.verse, r.verseEnd), 'livre'), path: chapterPath(r.book, r.chapter, r.verse) };
}

const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const embed = (id: string) => `https://www.youtube.com/embed/${id}?autoplay=1&playsinline=1&rel=0`;

export function ChosenShorts({ onMakeScene }: { onMakeScene?: (it: ChosenItem) => void }) {
  const { data, reload } = useApi<{ items: ChosenItem[] }>('/cenas/novidades');
  const [open, setOpen] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const items = (data?.items ?? []).filter((i) => !hidden.includes(i.youtube_id));
  if (!items.length) return null;

  return (
    <section className="stack" style={{ gap: 8 }} aria-label="Novidades de The Chosen">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <Sparkles size={18} />
        <h2 style={{ fontSize: 17, margin: 0 }}>Novidades de The Chosen</h2>
      </div>
      <div className="reels-strip">
        {items.map((it, i) => (
          <button key={it.youtube_id} className="reel-card" onClick={() => setOpen(i)} aria-label={`Assistir: ${it.title}`}>
            <img src={thumb(it.youtube_id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <span className="reel-play">
              <Play size={18} fill="currentColor" />
            </span>
            <span className="reel-title clamp-2">{it.title}</span>
          </button>
        ))}
      </div>
      {open !== null && (
        <ReelsViewer
          items={items}
          start={open}
          onClose={() => setOpen(null)}
          onHide={(id) => {
            setHidden((h) => [...h, id]);
            void reload();
          }}
          onMakeScene={onMakeScene}
        />
      )}
    </section>
  );
}

function ReelsViewer({
  items,
  start,
  onClose,
  onHide,
  onMakeScene,
}: {
  items: ChosenItem[];
  start: number;
  onClose: () => void;
  onHide: (id: string) => void;
  onMakeScene?: (it: ChosenItem) => void;
}) {
  const { isMedia } = useSession();
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(start);

  // Abre já no Short tocado e trava a rolagem da página por trás.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = start * el.clientHeight;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      removeEventListener('keydown', onKey);
    };
  }, []);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const i = Math.round(el.scrollTop / el.clientHeight);
    if (i !== active && i >= 0 && i < items.length) setActive(i);
  };

  const go = (i: number) => {
    const el = box.current;
    if (el && i >= 0 && i < items.length) el.scrollTo({ top: i * el.clientHeight, behavior: 'smooth' });
  };

  const shareIt = async (it: ChosenItem) => {
    const url = `https://www.youtube.com/shorts/${it.youtube_id}`;
    try {
      if (navigator.share) return void (await navigator.share({ title: it.title, text: `🎬 ${it.title}`, url }));
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    const r = await share(it.title, `🎬 ${it.title}\n${url}`, '/cenas');
    if (r === 'copied') toast('Link copiado!', 'ok');
  };

  const hide = async (it: ChosenItem) => {
    try {
      await api(`/cenas/novidades/${it.youtube_id}/esconder`, { method: 'POST' });
      toast('Vídeo escondido.', 'ok');
      onHide(it.youtube_id);
      if (items.length <= 1) onClose();
    } catch (e) {
      toastError(e);
    }
  };

  return createPortal(
    <div className="reels-viewer" role="dialog" aria-modal="true" aria-label="Shorts de The Chosen">
      <button className="reels-close" aria-label="Fechar" onClick={onClose}>
        <X />
      </button>
      <div className="reels-nav">
        <button aria-label="Anterior" disabled={active === 0} onClick={() => go(active - 1)}>
          <ChevronUp />
        </button>
        <button aria-label="Próximo" disabled={active >= items.length - 1} onClick={() => go(active + 1)}>
          <ChevronDown />
        </button>
      </div>
      <div className="reels-scroll" ref={box} onScroll={onScroll}>
        {items.map((it, i) => {
          const ref = chosenRef(it);
          return (
            <div className="reel-slide" key={it.youtube_id}>
              <div className="reel-frame">
                {i === active ? (
                  <iframe
                    src={embed(it.youtube_id)}
                    title={it.title}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                ) : (
                  <img src={thumb(it.youtube_id)} alt="" loading="lazy" referrerPolicy="no-referrer" />
                )}
              </div>
              <div className="reel-info">
                <div className="reel-text">{it.title}</div>
                {ref && (
                  <Link className="reel-ref" to={ref.path} onClick={onClose}>
                    <BookOpenText size={14} /> {ref.label}
                  </Link>
                )}
                <div className="reel-actions">
                  <button onClick={() => void shareIt(it)}>
                    <Share2 size={16} /> Compartilhar
                  </button>
                  {isMedia && onMakeScene && (
                    <button
                      onClick={() => {
                        onClose();
                        onMakeScene(it);
                      }}
                    >
                      <Clapperboard size={16} /> Virar cena
                    </button>
                  )}
                  {isMedia && (
                    <button onClick={() => void hide(it)}>
                      <EyeOff size={16} /> Esconder
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="reels-foot">Canal oficial The Chosen no YouTube · arraste para cima para o próximo</div>
    </div>,
    document.body,
  );
}
