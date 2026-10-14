/**
 * "Cenas que pregam" — estudos com a série The Chosen.
 * Cada cena é um TRECHO de um vídeo oficial da série, tocado pelo player do YouTube (início e fim em segundos):
 * o app não guarda, baixa nem recorta o vídeo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clapperboard, Info, MessageCircleQuestion, Pencil, Plus, RotateCcw, Share2, Trash2 } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Scene } from '../lib/types';
import { share } from '../lib/ics';
import { bookByN } from '../lib/bible';
import { Button, Chips, confirmDialog, Empty, ErrorBox, LoadingList, Page, Sheet, TextField, Toggle, toast, toastError, useAction } from '../components/ui';
import { parseClock } from '../lib/clock';
import { clock, passageLabel, PassageCard, PassageField, readPassage, SceneCard } from '../components/Passage';
import { ChosenShorts, chosenRef, type ChosenItem } from '../components/ChosenReels';

/** Segundo de início que veio no próprio link (…?t=83 ou &t=1m23s). */
function startFromLink(url: string): number | null {
  try {
    const u = new URL(url.trim());
    const t = u.searchParams.get('t') ?? u.searchParams.get('start');
    if (!t) return null;
    const n = parseClock(t);
    return n !== null && !Number.isNaN(n) ? n : null;
  } catch {
    return null;
  }
}

const embedUrl = (s: Pick<Scene, 'youtube_id' | 'start_s' | 'end_s'>) =>
  `https://www.youtube.com/embed/${s.youtube_id}?playsinline=1&rel=0&start=${s.start_s}${s.end_s ? `&end=${s.end_s}` : ''}`;

function trechoLabel(s: Pick<Scene, 'start_s' | 'end_s'>) {
  if (!s.end_s && !s.start_s) return 'Vídeo completo da cena';
  return s.end_s ? `Trecho de ${clock(s.start_s)} a ${clock(s.end_s)} (${clock(s.end_s - s.start_s)})` : `A partir de ${clock(s.start_s)}`;
}

// ---------------- lista ----------------

export default function Scenes() {
  const { isMedia } = useSession();
  const [book, setBook] = useState('');
  const [adding, setAdding] = useState(false);
  const [fromShort, setFromShort] = useState<ChosenItem | null>(null);
  const { data, error, loading, reload } = useApi<{ scenes: Scene[] }>('/cenas');
  const all = data?.scenes ?? [];
  const books = useMemo(() => [...new Set(all.map((s) => s.bible_book))].sort((a, b) => a - b), [all]);
  const list = book ? all.filter((s) => String(s.bible_book) === book) : all;

  return (
    <Page
      title="Cenas que pregam"
      back="/videos"
      actions={
        isMedia ? (
          <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
            Cena
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Trechos da série <em>The Chosen</em> com a passagem da Bíblia, uma palavra do pastor e perguntas para conversar na célula e em família.
        </p>
        <ChosenShorts onMakeScene={setFromShort} />
        {books.length > 1 && (
          <Chips value={book} onChange={setBook} options={[{ value: '', label: 'Todos os livros' }, ...books.map((n) => ({ value: String(n), label: bookByN(n).pt }))]} />
        )}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList n={4} h={190} />
        ) : list.length ? (
          <div className="video-grid">
            {list.map((s) => (
              <SceneCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <Empty
            icon={<Clapperboard />}
            title="Nenhuma cena ainda"
            text={isMedia ? 'Adicione a primeira: cole o link do vídeo oficial da série e marque o início e o fim da cena.' : 'Volte em breve!'}
          />
        )}
        <p className="tiny muted center">
          Os vídeos tocam pelo YouTube, direto dos canais oficiais da série. <em>The Chosen</em> é uma série de 5&amp;2 Studios; o app não é ligado à produção.
        </p>
      </div>
      {adding && <SceneSheet onClose={() => setAdding(false)} onDone={() => void reload()} />}
      {fromShort && (
        <SceneSheet
          prefill={{ link: `https://youtube.com/shorts/${fromShort.youtube_id}`, title: fromShort.title, ref: chosenRef(fromShort)?.label ?? '' }}
          onClose={() => setFromShort(null)}
          onDone={() => void reload()}
        />
      )}
    </Page>
  );
}

// ---------------- cena ----------------

export function SceneDetail() {
  const { id } = useParams();
  const { isMedia } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ scene: Scene }>(`/cenas/${id}`);
  const [editing, setEditing] = useState(false);
  const [replay, setReplay] = useState(0);
  const s = data?.scene;

  const shareScene = async () => {
    if (!s) return;
    const qs = s.questions.length ? `\n\nPara conversar:\n${s.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : '';
    const r = await share(s.title, `🎬 ${s.title}\n📖 ${passageLabel(s)}${qs}`, `/cenas/${s.id}`);
    if (r === 'copied') toast('Link copiado!', 'ok');
  };

  return (
    <Page
      title={s?.title ?? 'Cena'}
      back="/cenas"
      actions={
        s && (
          <>
            <button className="icon-btn" aria-label="Compartilhar" onClick={() => void shareScene()}>
              <Share2 />
            </button>
            {isMedia && (
              <button className="icon-btn" aria-label="Editar" onClick={() => setEditing(true)}>
                <Pencil />
              </button>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox error={error} retry={reload} />}
      {s && (
        <article className="stack">
          <div className="player player-full">
            <iframe
              key={replay}
              src={embedUrl(s)}
              title={s.title}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span className="small muted">
              {trechoLabel(s)}
              {s.channel ? ` · Canal: ${s.channel}` : ''}
            </span>
            <button className="link-btn small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => setReplay((n) => n + 1)}>
              <RotateCcw size={14} /> Ver de novo
            </button>
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 560 }}>{s.title}</h1>
            {s.episode && <div className="muted mt-1">{s.episode}</div>}
            {s.visibility === 'members' && <span className="badge blue mt-1">Só membros</span>}
          </div>

          <PassageCard v={s} />

          {s.pastor_text && (
            <section className="stack" style={{ gap: 6 }}>
              <h2 style={{ fontSize: 17 }}>Palavra do pastor</h2>
              <div className="pre" style={{ fontSize: 16, lineHeight: 1.6 }}>
                {s.pastor_text}
              </div>
            </section>
          )}

          {s.questions.length > 0 && (
            <section className="card card-pad stack" style={{ gap: 10 }}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <MessageCircleQuestion size={18} />
                <h2 style={{ fontSize: 17, margin: 0 }}>Para conversar na célula e em família</h2>
              </div>
              <ol className="scene-questions">
                {s.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ol>
            </section>
          )}

          <Button variant="secondary" icon={<Share2 />} onClick={() => void shareScene()}>
            Compartilhar com a célula
          </Button>
          <Link className="link-btn small" to="/cenas" style={{ alignSelf: 'center' }}>
            Ver todas as cenas
          </Link>
        </article>
      )}
      {editing && s && <SceneSheet scene={s} onClose={() => setEditing(false)} onDone={() => void reload()} onDeleted={() => navigate('/cenas')} />}
    </Page>
  );
}

// ---------------- cadastro ----------------

function SceneSheet({
  scene,
  prefill,
  onClose,
  onDone,
  onDeleted,
}: {
  scene?: Scene;
  /** Vindo de um Short de "Novidades de The Chosen": já preenche link, título e passagem. */
  prefill?: { link: string; title: string; ref: string };
  onClose: () => void;
  onDone: () => void;
  onDeleted?: () => void;
}) {
  const navigate = useNavigate();
  const [link, setLink] = useState(scene ? `https://youtu.be/${scene.youtube_id}` : (prefill?.link ?? ''));
  const [start, setStart] = useState(scene ? clock(scene.start_s) : '');
  const [end, setEnd] = useState(scene?.end_s ? clock(scene.end_s) : '');
  const [title, setTitle] = useState(scene?.title ?? prefill?.title.slice(0, 140) ?? '');
  const [episode, setEpisode] = useState(scene?.episode ?? '');
  const [ref, setRef] = useState(scene ? passageLabel(scene) : (prefill?.ref ?? ''));
  const [text, setText] = useState(scene?.pastor_text ?? '');
  const [questions, setQuestions] = useState<string[]>(() => {
    const q = [...(scene?.questions ?? [])];
    while (q.length < 3) q.push('');
    return q;
  });
  const [isPublic, setIsPublic] = useState(scene ? scene.visibility === 'public' : true);
  const { busy, run } = useAction();

  // Link com "?t=…" (Compartilhar → "Começar em") já preenche o início.
  useEffect(() => {
    if (start) return;
    const t = startFromLink(link);
    if (t !== null) setStart(clock(t));
  }, [link]);

  const s0 = parseClock(start);
  const s1 = parseClock(end);
  const timeErr =
    Number.isNaN(s0) || Number.isNaN(s1)
      ? 'Use minutos:segundos, por exemplo 12:30.'
      : s1 !== null && (s0 ?? 0) >= s1
        ? 'O fim precisa ser depois do início.'
        : '';

  const save = () =>
    run(async () => {
      if (timeErr) throw new Error(timeErr);
      const passage = readPassage(ref);
      if (!passage) throw new Error('Diga a passagem bíblica da cena (ex.: jo 4:1-26).');
      if (passage === 'erro') throw new Error('Não entendi a passagem bíblica. Ex.: jo 4:1-26.');
      const payload = {
        youtube: link,
        start_s: s0 ?? 0,
        end_s: s1,
        title,
        episode,
        passage,
        pastor_text: text,
        questions: questions.map((q) => q.trim()).filter(Boolean),
        visibility: isPublic ? 'public' : 'members',
      };
      if (scene) await api(`/cenas/${scene.id}`, { method: 'PUT', body: payload });
      else {
        const r = await api<{ id: number }>('/cenas', { method: 'POST', body: payload });
        navigate(`/cenas/${r.id}`);
      }
      onDone();
      onClose();
    }, 'Cena salva.');

  return (
    <Sheet
      open
      title={scene ? 'Editar cena' : 'Nova cena'}
      onClose={onClose}
      footer={
        <>
          {scene && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar esta cena?', text: 'O vídeo continua no YouTube.', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/cenas/${scene.id}`, { method: 'DELETE' });
                  toast('Cena apagada.', 'ok');
                  onClose();
                  onDeleted?.();
                  onDone();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Apagar
            </Button>
          )}
          <Button loading={busy} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="alert">
          <Info />
          <div className="small">
            Use só vídeos dos <strong>canais oficiais</strong> da série no YouTube (vídeo repostado por terceiros pode sair do ar ou ser pirata). O app
            não baixa nem corta o vídeo: ele toca pelo YouTube só do início ao fim que você marcar.
          </div>
        </div>
        <TextField label="Link do vídeo oficial no YouTube" value={link} onChange={setLink} inputMode="url" placeholder="https://youtu.be/…" hint="No YouTube: Compartilhar → Copiar link." />
        <div className="form-grid">
          <TextField label="Começa em" value={start} onChange={setStart} placeholder="12:30" inputMode="numeric" />
          <TextField label="Termina em" value={end} onChange={setEnd} placeholder="16:05" inputMode="numeric" />
        </div>
        {timeErr ? <div className="small" style={{ color: 'var(--danger)', marginTop: -6 }}>{timeErr}</div> : null}
        <TextField label="Título da cena" value={title} onChange={setTitle} maxLength={140} placeholder="Ex.: Jesus e a mulher samaritana" />
        <TextField label="Temporada / episódio (opcional)" value={episode} onChange={setEpisode} maxLength={80} placeholder="Ex.: Temporada 1 · Episódio 8" />
        <PassageField value={ref} onChange={setRef} />
        <TextField label="Palavra do pastor (curta)" value={text} onChange={setText} multiline rows={4} maxLength={3000} />
        <div className="field">
          <span className="field-label">Perguntas para conversar (2 ou 3)</span>
          <div className="stack" style={{ gap: 8 }}>
            {questions.map((q, i) => (
              <input
                key={i}
                className="input"
                value={q}
                maxLength={300}
                placeholder={`Pergunta ${i + 1}`}
                aria-label={`Pergunta ${i + 1}`}
                onChange={(e) => setQuestions((list) => list.map((x, j) => (j === i ? e.target.value : x)))}
              />
            ))}
            {questions.length < 5 && (
              <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setQuestions((l) => [...l, ''])}>
                + Outra pergunta
              </button>
            )}
          </div>
        </div>
        <Toggle label="Pública" hint={isPublic ? 'Visitantes também veem.' : 'Só membros aprovados veem.'} checked={isPublic} onChange={setIsPublic} />
      </div>
    </Sheet>
  );
}
