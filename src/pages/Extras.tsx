/** Mensagem do Pastor (diária), pregações em áudio e mural de ajuda mútua. */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  HandHelping,
  Headphones,
  Mail,
  MessageCircle,
  Mic,
  Pencil,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Share2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { HelpKind, HelpPost, PastorMessage, Sermon } from '../lib/types';
import { ago, duration as fmtDuration, longDate, phoneLink, relativeDay, shortDate, todayYmd } from '../lib/format';
import { helpDrain } from '../lib/push';
import { share } from '../lib/ics';
import { uploadAudio } from '../lib/upload';
import {
  Avatar,
  Button,
  Chips,
  confirmDialog,
  CoverPicker,
  Empty,
  ErrorBox,
  LoadingList,
  MediaImg,
  MembersOnly,
  mediaUrl,
  Page,
  Seg,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';
import './Extras.css';

// ======================= MÍDIA (áudio / YouTube) =======================

export function ytId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m|music)\./, '');
    const ok = (v: string | null | undefined) => (v && /^[A-Za-z0-9_-]{11}$/.test(v) ? v : null);
    if (host === 'youtu.be') return ok(u.pathname.slice(1).split('/')[0]);
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      return ok(u.searchParams.get('v')) ?? ok(u.pathname.match(/^\/(?:live|shorts|embed|v)\/([A-Za-z0-9_-]{11})/)?.[1]);
    }
  } catch {
    /* link inválido */
  }
  return null;
}

const SPEEDS = [1, 1.25, 1.5, 2];

function readPos(key: string): number {
  try {
    return Number(localStorage.getItem(`irn-pos:${key}`)) || 0;
  } catch {
    return 0;
  }
}
function savePos(key: string, t: number) {
  try {
    if (t > 0) localStorage.setItem(`irn-pos:${key}`, String(Math.floor(t)));
    else localStorage.removeItem(`irn-pos:${key}`);
  } catch {
    /* sem armazenamento local */
  }
}

/** Player de áudio com velocidade, voltar 15s / avançar 30s e "continuar de onde parou". */
export function AudioPlayer({ src, storageKey, onFirstPlay }: { src: string; storageKey: string; onFirstPlay?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);
  const [resumeAt, setResumeAt] = useState(0);
  const played = useRef(false);
  const lastSave = useRef(0);

  useEffect(() => {
    setResumeAt(readPos(storageKey));
  }, [storageKey]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  const skip = (s: number) => {
    const a = ref.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min((a.duration || Infinity) - 1, a.currentTime + s));
  };

  return (
    <div className="audio-box stack" style={{ gap: 10 }}>
      <audio
        ref={ref}
        src={src}
        controls
        preload="metadata"
        style={{ width: '100%' }}
        onPlay={() => {
          if (ref.current) ref.current.playbackRate = speed;
          if (!played.current) {
            played.current = true;
            onFirstPlay?.();
          }
        }}
        onTimeUpdate={(e) => {
          const a = e.currentTarget;
          if (Math.abs(a.currentTime - lastSave.current) < 5) return;
          lastSave.current = a.currentTime;
          savePos(storageKey, a.duration && a.currentTime > a.duration - 20 ? 0 : a.currentTime);
        }}
        onEnded={() => savePos(storageKey, 0)}
      />
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="icon-btn" aria-label="Voltar 15 segundos" title="Voltar 15s" onClick={() => skip(-15)}>
          <RotateCcw />
        </button>
        <button className="icon-btn" aria-label="Avançar 30 segundos" title="Avançar 30s" onClick={() => skip(30)}>
          <RotateCw />
        </button>
        <span className="grow" />
        <div className="seg" role="group" aria-label="Velocidade">
          {SPEEDS.map((s) => (
            <button key={s} type="button" className={speed === s ? 'on' : ''} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
              {String(s).replace('.', ',')}x
            </button>
          ))}
        </div>
      </div>
      {resumeAt > 10 && (
        <button
          className="link-btn small"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => {
            const a = ref.current;
            if (!a) return;
            a.currentTime = resumeAt;
            void a.play().catch(() => undefined);
            setResumeAt(0);
          }}
        >
          Continuar de onde parei ({fmtDuration(resumeAt)})
        </button>
      )}
    </div>
  );
}

function YouTubeFrame({ id, title }: { id: string; title: string }) {
  return (
    <div className="player">
      <iframe
        src={`https://www.youtube.com/embed/${id}?playsinline=1&rel=0`}
        title={title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function MediaBlock({ audioId, url, title, storageKey, onFirstPlay }: { audioId: string | null; url: string | null; title: string; storageKey: string; onFirstPlay?: () => void }) {
  if (audioId) return <AudioPlayer src={mediaUrl(audioId)} storageKey={storageKey} onFirstPlay={onFirstPlay} />;
  const yt = ytId(url);
  if (yt) return <YouTubeFrame id={yt} title={title} />;
  if (url && /\.(mp4|webm|mov)(\?|#|$)/i.test(url))
    return (
      <div className="player">
        <video src={url} controls playsInline preload="metadata" />
      </div>
    );
  if (url) return <AudioPlayer src={url} storageKey={storageKey} onFirstPlay={onFirstPlay} />;
  return null;
}

/** Escolhe um áudio: envia o arquivo (com R2) ou cola um link (YouTube ou áudio). */
function AudioInput({
  audioId,
  setAudioId,
  link,
  setLink,
  access,
  linkLabel,
  onDuration,
}: {
  audioId: string | null;
  setAudioId: (id: string | null) => void;
  link: string;
  setLink: (v: string) => void;
  access: 'public' | 'members';
  linkLabel: string;
  onDuration?: (d: number | null) => void;
}) {
  const { features } = useSession();
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState('');
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (file: File) => {
    if (file.size > 600 * 1024 * 1024) return toast('Arquivo muito grande (máximo 600 MB).', 'error');
    abort.current = new AbortController();
    setName(file.name);
    setProgress(0);
    try {
      const r = await uploadAudio(file, access, setProgress, abort.current.signal);
      setAudioId(r.mediaId);
      onDuration?.(r.duration);
      toast('Áudio enviado!', 'ok');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toastError(e);
      setName('');
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="field-label" style={{ fontWeight: 620, fontSize: 14 }}>
        Áudio
      </div>
      {audioId ? (
        <div className="card card-pad row" style={{ gap: 10 }}>
          <span className="icon-tile gold" style={{ width: 36, height: 36 }}>
            <Headphones size={18} />
          </span>
          <div className="grow small ellipsis">{name || 'Áudio anexado'}</div>
          <button className="icon-btn" aria-label="Remover áudio" onClick={() => setAudioId(null)}>
            <X />
          </button>
        </div>
      ) : progress !== null ? (
        <div className="card card-pad stack" style={{ gap: 8 }}>
          <div className="small ellipsis">Enviando {name}…</div>
          <div className="progress gold">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="row">
            <span className="tiny muted grow">{Math.round(progress * 100)}%</span>
            <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : features.video_upload ? (
        <>
          <input
            ref={input}
            type="file"
            accept="audio/*,.mp3,.m4a,.aac,.ogg,.opus,.wav"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pick(f);
            }}
          />
          <Button variant="secondary" icon={<Upload />} onClick={() => input.current?.click()}>
            Enviar arquivo de áudio (MP3, M4A…)
          </Button>
        </>
      ) : (
        <div className="small muted">
          Para enviar arquivos de áudio pelo app, ative o armazenamento R2 (Administração → Configurações). Por enquanto, cole um link abaixo.
        </div>
      )}
      {!audioId && progress === null && (
        <TextField
          label={linkLabel}
          value={link}
          onChange={setLink}
          inputMode="url"
          placeholder="https://…"
          hint="Link do YouTube ou de um arquivo de áudio (MP3) na internet."
        />
      )}
    </div>
  );
}

// ======================= MENSAGEM DO PASTOR =======================

export function PastorHomeCard({ m, today }: { m: PastorMessage; today: string }) {
  const { church } = useSession();
  const hasMedia = !!(m.audio_id || m.media_url);
  return (
    <Link to={`/mensagem/${m.id}`} className="pastor-card">
      {m.image_id && <MediaImg id={m.image_id} className="pastor-card-img" />}
      <div className="pastor-card-body">
        <div className="kicker row" style={{ gap: 6 }}>
          <Mic size={14} /> Mensagem do Pastor · {m.day === today ? 'Hoje' : relativeDay(m.day) === 'Ontem' ? 'Ontem' : shortDate(m.day)}
        </div>
        <h3>{m.title}</h3>
        {m.verse && <p className="verse mt-1 clamp-3">{m.verse}</p>}
        <div className="row small mt-1" style={{ gap: 8, flexWrap: 'wrap' }}>
          {m.reference && <span style={{ fontWeight: 650, color: 'var(--gold)' }}>{m.reference}</span>}
          <span className="muted">— {m.author || church.pastor_display}</span>
          {hasMedia && (
            <span className="badge gold">
              <Headphones size={12} /> Ouvir
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function PastorMessages() {
  const { isLeader, church } = useSession();
  const { data, error, loading, reload } = useApi<{ messages: PastorMessage[]; today: string }>(`/mensagens${isLeader ? '?futuras=1' : ''}`);
  const [edit, setEdit] = useState<PastorMessage | 'new' | null>(null);
  const today = data?.today ?? todayYmd();
  return (
    <Page
      title="Mensagem do Pastor"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEdit('new')}>
            Nova
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Uma palavra por dia do {church.pastor_display} para a sua caminhada.
        </p>
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.messages.length ? (
          data.messages.map((m) => (
            <Link key={m.id} to={`/mensagem/${m.id}`} className={m.day === today ? 'word-card' : 'card card-pad card-link'}>
              <div className="row-between">
                <span className={m.day === today ? 'kicker' : 'small muted'} style={{ fontWeight: 650 }}>
                  {m.day === today ? 'Hoje' : m.day > today ? `Agendada: ${longDate(m.day)}` : longDate(m.day)}
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {(m.audio_id || m.media_url) && (
                    <span className="badge gold">
                      <Headphones size={12} />
                    </span>
                  )}
                  {m.day > today && <span className="badge warn">Agendada</span>}
                </span>
              </div>
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: 19, marginTop: 6, fontWeight: 560 }}>{m.title}</h3>
              {m.reference && <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, marginTop: 4 }}>{m.reference}</div>}
              {m.verse && <p className="small clamp-2 mt-1" style={{ color: 'var(--ink-2)' }}>{m.verse}</p>}
            </Link>
          ))
        ) : (
          <Empty
            icon={<Mic />}
            title="Nenhuma mensagem publicada ainda"
            text={isLeader ? 'Publique a primeira — dá para agendar os próximos dias. A notificação sai pela manhã.' : 'Volte amanhã!'}
          />
        )}
      </div>
      {edit && <PastorSheet message={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => void reload()} />}
    </Page>
  );
}

export function PastorDetail() {
  const { id } = useParams();
  const { isLeader, church } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ message: PastorMessage }>(`/mensagens/${id}`);
  const [editing, setEditing] = useState(false);
  const m = data?.message;
  return (
    <Page
      title="Mensagem do Pastor"
      back="/mensagem"
      actions={
        m && (
          <>
            <button
              className="icon-btn"
              aria-label="Compartilhar"
              onClick={async () => {
                const text = `${m.title}${m.reference ? ` (${m.reference})` : ''}${m.verse ? `\n\n${m.verse}` : ''}\n\n— ${m.author || church.pastor_display}`;
                const r = await share(m.title, text, `/mensagem/${m.id}`);
                if (r === 'copied') toast('Copiado para compartilhar!', 'ok');
              }}
            >
              <Share2 />
            </button>
            {isLeader && (
              <button className="icon-btn" aria-label="Editar" onClick={() => setEditing(true)}>
                <Pencil />
              </button>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox error={error} retry={reload} />}
      {m && (
        <article className="stack">
          {m.image_id && <MediaImg id={m.image_id} className="cover" />}
          <div className="small" style={{ color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {longDate(m.day)}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 560 }}>{m.title}</h1>
          <MediaBlock audioId={m.audio_id} url={m.media_url} title={m.title} storageKey={`msg-${m.id}`} />
          {m.verse && <blockquote className="verse" style={{ margin: 0 }}>{m.verse}</blockquote>}
          {m.reference && <div style={{ fontWeight: 650, color: 'var(--gold)' }}>{m.reference}</div>}
          {m.body && (
            <div className="pre" style={{ fontSize: 16.5, lineHeight: 1.65 }}>
              {m.body}
            </div>
          )}
          <div className="muted">— {m.author || church.pastor_display}</div>
          <Link to="/mensagem" className="btn btn-secondary">
            Mensagens anteriores
          </Link>
        </article>
      )}
      {editing && m && <PastorSheet message={m} onClose={() => setEditing(false)} onDone={() => void reload()} onDeleted={() => navigate('/mensagem')} />}
    </Page>
  );
}

function PastorSheet({ message, onClose, onDone, onDeleted }: { message?: PastorMessage; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const { church } = useSession();
  const [day, setDay] = useState(message?.day ?? todayYmd());
  const [title, setTitle] = useState(message?.title ?? '');
  const [reference, setReference] = useState(message?.reference ?? '');
  const [verse, setVerse] = useState(message?.verse ?? '');
  const [body, setBody] = useState(message?.body ?? '');
  const [author, setAuthor] = useState(message?.author ?? church.pastor_display);
  const [image, setImage] = useState<string | null>(message?.image_id ?? null);
  const [audio, setAudio] = useState<string | null>(message?.audio_id ?? null);
  const [link, setLink] = useState(message?.media_url ?? '');
  const [isPublic, setIsPublic] = useState(message ? message.visibility === 'public' : true);
  const [notify, setNotify] = useState(false);
  const { busy, run } = useAction();
  const isToday = day === todayYmd();
  return (
    <Sheet
      open
      title={message ? 'Editar mensagem' : 'Nova Mensagem do Pastor'}
      onClose={onClose}
      footer={
        <>
          {message && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar esta mensagem?', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/mensagens/${message.id}`, { method: 'DELETE' });
                  toast('Apagada.', 'ok');
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
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const payload = {
                  day,
                  title,
                  reference,
                  verse,
                  body,
                  author,
                  image_id: image,
                  audio_id: audio,
                  media_url: audio ? null : link,
                  visibility: isPublic ? 'public' : 'members',
                  notify: !message && isToday && notify,
                };
                if (message) await api(`/mensagens/${message.id}`, { method: 'PUT', body: payload });
                else await api('/mensagens', { method: 'POST', body: payload });
                if (payload.notify) void helpDrain();
                onDone();
                onClose();
              }, 'Mensagem salva.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Dia" type="date" value={day} onChange={setDay} hint="Pode agendar para os próximos dias. A notificação sai no dia, pela manhã." />
        <TextField label="Título" value={title} onChange={setTitle} maxLength={120} placeholder="Ex.: Não temas, eu estou contigo" />
        <TextField label="Referência bíblica" value={reference} onChange={setReference} maxLength={80} placeholder="Ex.: Isaías 41.10" />
        <TextField label="Versículo (texto)" value={verse} onChange={setVerse} multiline rows={3} maxLength={1200} />
        <TextField label="Mensagem" value={body} onChange={setBody} multiline rows={7} maxLength={12000} />
        <AudioInput audioId={audio} setAudioId={setAudio} link={link} setLink={setLink} access={isPublic ? 'public' : 'members'} linkLabel="Link do áudio ou vídeo (opcional)" />
        <TextField label="Assinatura" value={author} onChange={setAuthor} maxLength={80} />
        <CoverPicker value={image} onChange={setImage} access={isPublic ? 'public' : 'members'} />
        <Toggle label="Pública" hint={isPublic ? 'Visitantes também veem.' : 'Só membros veem.'} checked={isPublic} onChange={setIsPublic} />
        {!message && isToday && <Toggle label="Avisar agora por notificação" hint="Se deixar desligado, o aviso sai sozinho pela manhã." checked={notify} onChange={setNotify} />}
      </div>
    </Sheet>
  );
}

// ======================= PREGAÇÕES EM ÁUDIO =======================

export function Sermons() {
  const { isMedia } = useSession();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, loading, reload } = useApi<{ sermons: Sermon[]; more: boolean }>(`/pregacoes${query ? `?q=${encodeURIComponent(query)}` : ''}`);
  const [edit, setEdit] = useState<Sermon | 'new' | null>(null);
  return (
    <Page
      title="Pregações"
      actions={
        isMedia ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEdit('new')}>
            Pregação
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="search-box" role="search">
          <Search className="ico" aria-hidden />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por tema, pregador ou texto" aria-label="Buscar pregações" />
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.sermons.length ? (
          <div className="card">
            <div className="list">
              {data.sermons.map((s) => (
                <Link key={s.id} to={`/pregacoes/${s.id}`} className="list-item">
                  {s.cover_id ? (
                    <MediaImg id={s.cover_id} style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', flex: 'none' }} />
                  ) : (
                    <span className="icon-tile gold" style={{ width: 52, height: 52, borderRadius: 12 }}>
                      <Headphones />
                    </span>
                  )}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 620 }} className="clamp-2">
                      {s.title}
                    </div>
                    <div className="small muted ellipsis">
                      {[s.preacher, s.reference, shortDate(s.preached_on), s.duration ? fmtDuration(s.duration) : null].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <ChevronRight className="chev" size={18} />
                </Link>
              ))}
            </div>
          </div>
        ) : (
          <Empty
            icon={<Headphones />}
            title={query ? 'Nada encontrado' : 'Nenhuma pregação ainda'}
            text={query ? 'Tente outra palavra.' : isMedia ? 'Publique a primeira: envie o áudio ou cole o link do culto no YouTube.' : 'As pregações dos cultos aparecem aqui para ouvir quando quiser.'}
          />
        )}
      </div>
      {edit && <SermonSheet sermon={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => void reload()} />}
    </Page>
  );
}

export function SermonDetail() {
  const { id } = useParams();
  const { isMedia } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ sermon: Sermon }>(`/pregacoes/${id}`);
  const [editing, setEditing] = useState(false);
  const s = data?.sermon;
  const counted = () => void api(`/pregacoes/${id}/ouvir`, { method: 'POST', body: {} }).catch(() => undefined);
  return (
    <Page
      title="Pregação"
      back="/pregacoes"
      actions={
        s && (
          <>
            <button
              className="icon-btn"
              aria-label="Compartilhar"
              onClick={async () => {
                const r = await share(s.title, `${s.title}${s.preacher ? ` — ${s.preacher}` : ''}`, `/pregacoes/${s.id}`);
                if (r === 'copied') toast('Link copiado!', 'ok');
              }}
            >
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
          {s.cover_id && !s.youtube_id && <MediaImg id={s.cover_id} className="cover" />}
          <div className="small" style={{ color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {longDate(s.preached_on)}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 560 }}>{s.title}</h1>
          <div className="muted">{[s.preacher, s.reference].filter(Boolean).join(' · ')}</div>
          {s.youtube_id && !s.audio_id && !s.audio_url ? (
            <div onClickCapture={counted}>
              <YouTubeFrame id={s.youtube_id} title={s.title} />
            </div>
          ) : (
            <MediaBlock audioId={s.audio_id} url={s.audio_url} title={s.title} storageKey={`serm-${s.id}`} onFirstPlay={counted} />
          )}
          {s.youtube_id && (s.audio_id || s.audio_url) && (
            <a className="btn btn-secondary" href={`https://www.youtube.com/watch?v=${s.youtube_id}`} target="_blank" rel="noreferrer">
              Assistir o vídeo no YouTube
            </a>
          )}
          {s.description && <div className="pre" style={{ fontSize: 16, lineHeight: 1.6 }}>{s.description}</div>}
          {isMedia && <div className="tiny muted">{s.plays} pessoa(s) ouviram · {s.visibility === 'public' ? 'Pública' : 'Só membros'}</div>}
        </article>
      )}
      {editing && s && <SermonSheet sermon={s} onClose={() => setEditing(false)} onDone={() => void reload()} onDeleted={() => navigate('/pregacoes')} />}
    </Page>
  );
}

function SermonSheet({ sermon, onClose, onDone, onDeleted }: { sermon?: Sermon; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const { church } = useSession();
  const navigate = useNavigate();
  const [title, setTitle] = useState(sermon?.title ?? '');
  const [preacher, setPreacher] = useState(sermon?.preacher ?? church.pastor_display);
  const [reference, setReference] = useState(sermon?.reference ?? '');
  const [date, setDate] = useState(sermon?.preached_on ?? todayYmd());
  const [description, setDescription] = useState(sermon?.description ?? '');
  const [audio, setAudio] = useState<string | null>(sermon?.audio_id ?? null);
  const [audioUrl, setAudioUrl] = useState(sermon?.audio_url ?? '');
  const [youtube, setYoutube] = useState(sermon?.youtube_id ? `https://youtu.be/${sermon.youtube_id}` : '');
  const [dur, setDur] = useState<number | null>(null);
  const [cover, setCover] = useState<string | null>(sermon?.cover_id ?? null);
  const [isPublic, setIsPublic] = useState(sermon ? sermon.visibility === 'public' : true);
  const [notify, setNotify] = useState(false);
  const { busy, run } = useAction();

  // Um link colado no campo de áudio que seja do YouTube vai para o campo certo.
  const linkIsYt = !!ytId(audioUrl);
  return (
    <Sheet
      open
      title={sermon ? 'Editar pregação' : 'Nova pregação'}
      onClose={onClose}
      footer={
        <>
          {sermon && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar esta pregação?', text: 'O áudio enviado também será apagado.', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/pregacoes/${sermon.id}`, { method: 'DELETE' });
                  toast('Apagada.', 'ok');
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
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const payload = {
                  title,
                  preacher,
                  reference,
                  preached_on: date,
                  description,
                  audio_id: audio,
                  audio_url: audio || linkIsYt ? null : audioUrl,
                  youtube: linkIsYt ? audioUrl : youtube,
                  duration: dur,
                  cover_id: cover,
                  visibility: isPublic ? 'public' : 'members',
                  notify: !sermon && notify,
                };
                if (sermon) await api(`/pregacoes/${sermon.id}`, { method: 'PUT', body: payload });
                else {
                  const r = await api<{ id: number }>('/pregacoes', { method: 'POST', body: payload });
                  if (notify) void helpDrain();
                  navigate(`/pregacoes/${r.id}`);
                }
                onDone();
                onClose();
              }, 'Pregação salva.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Título" value={title} onChange={setTitle} maxLength={140} placeholder="Ex.: O poder da fé" />
        <TextField label="Pregador" value={preacher} onChange={setPreacher} maxLength={80} />
        <TextField label="Texto bíblico" value={reference} onChange={setReference} maxLength={80} placeholder="Ex.: Hebreus 11.1-6" />
        <TextField label="Data" type="date" value={date} onChange={setDate} />
        <AudioInput audioId={audio} setAudioId={setAudio} link={audioUrl} setLink={setAudioUrl} access={isPublic ? 'public' : 'members'} linkLabel="Link do áudio (opcional)" onDuration={setDur} />
        {!linkIsYt && <TextField label="Link do vídeo no YouTube (opcional)" value={youtube} onChange={setYoutube} inputMode="url" placeholder="https://youtu.be/…" />}
        <TextField label="Resumo / anotações (opcional)" value={description} onChange={setDescription} multiline rows={4} maxLength={4000} />
        <CoverPicker value={cover} onChange={setCover} access={isPublic ? 'public' : 'members'} label="Capa (opcional)" />
        <Toggle label="Pública" hint={isPublic ? 'Visitantes também ouvem.' : 'Só membros ouvem.'} checked={isPublic} onChange={setIsPublic} />
        {!sermon && <Toggle label="Avisar por notificação" checked={notify} onChange={setNotify} />}
      </div>
    </Sheet>
  );
}

// ======================= MURAL DE AJUDA MÚTUA =======================

export const HELP_CATEGORIES: { value: string; label: string }[] = [
  { value: 'emprego', label: 'Emprego' },
  { value: 'servicos', label: 'Serviços' },
  { value: 'doacao', label: 'Doações' },
  { value: 'carona', label: 'Carona' },
  { value: 'moradia', label: 'Moradia' },
  { value: 'estudos', label: 'Estudos' },
  { value: 'saude', label: 'Saúde' },
  { value: 'outros', label: 'Outros' },
];
const catLabel = (v: string) => HELP_CATEGORIES.find((c) => c.value === v)?.label ?? 'Outros';
const STATUS_LABEL: Record<HelpPost['status'], [string, string]> = {
  pendente: ['Aguardando aprovação', 'warn'],
  aprovado: ['No mural', 'ok'],
  recusado: ['Não aprovado', 'danger'],
  resolvido: ['Resolvido', 'gold'],
};

function contactHref(contact: string, title: string): { href: string; label: string; icon: React.JSX.Element } | null {
  const c = contact.trim();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c)) return { href: `mailto:${c}?subject=${encodeURIComponent(title)}`, label: 'E-mail', icon: <Mail /> };
  const digits = c.replace(/\D/g, '');
  if (digits.length >= 10 && digits.length <= 13) return { href: phoneLink(c, `Olá! Vi no mural de ajuda da igreja: "${title}"`), label: 'WhatsApp', icon: <MessageCircle /> };
  return null;
}

export function HelpBoard() {
  return (
    <Page title="Ajuda mútua">
      <MembersOnly text="O mural de ajuda mútua é para os membros da igreja.">
        <HelpBoardInner />
      </MembersOnly>
    </Page>
  );
}

function HelpBoardInner() {
  const { user, isLeader } = useSession();
  const [params, setParams] = useSearchParams();
  const filtro = params.get('filtro') ?? 'mural';
  const [kind, setKind] = useState<'todos' | HelpKind>('todos');
  const [cat, setCat] = useState('todas');
  const qs = new URLSearchParams({ filtro });
  if (filtro === 'mural' && kind !== 'todos') qs.set('tipo', kind);
  if (filtro === 'mural' && cat !== 'todas') qs.set('categoria', cat);
  const { data, error, loading, reload } = useApi<{ posts: HelpPost[] }>(`/ajuda?${qs}`);
  const [edit, setEdit] = useState<HelpPost | 'new' | null>(null);
  const [refusing, setRefusing] = useState<HelpPost | null>(null);

  const options = [
    { value: 'mural', label: 'Mural' },
    { value: 'meus', label: 'Minhas publicações' },
    ...(isLeader ? [{ value: 'pendentes', label: 'Para aprovar' }] : []),
  ];

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'ok');
      void reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div className="stack">
      <div className="card card-pad row" style={{ background: 'var(--gold-soft)' }}>
        <span className="icon-tile gold">
          <HandHelping />
        </span>
        <div className="grow small" style={{ color: 'var(--ink-2)' }}>
          “Levai as cargas uns dos outros” (Gl 6.2). Peça ou ofereça ajuda: emprego, serviços, doações, carona… A liderança aprova antes de aparecer no mural.
        </div>
      </div>
      <Button icon={<Plus />} onClick={() => setEdit('new')}>
        Publicar no mural
      </Button>
      <Chips value={filtro} onChange={(v) => setParams({ filtro: v }, { replace: true })} options={options} />
      {filtro === 'mural' && (
        <>
          <Seg
            value={kind}
            onChange={setKind}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'preciso', label: 'Precisam' },
              { value: 'ofereco', label: 'Oferecem' },
            ]}
          />
          <Chips value={cat} onChange={setCat} options={[{ value: 'todas', label: 'Todas' }, ...HELP_CATEGORIES]} />
        </>
      )}
      {error && <ErrorBox error={error} retry={reload} />}
      {loading && !data ? (
        <LoadingList />
      ) : data?.posts.length ? (
        data.posts.map((p) => {
          const mine = p.user_id === user?.id;
          const contact = p.contact ? contactHref(p.contact, p.title) : null;
          const [stLabel, stTone] = STATUS_LABEL[p.status];
          return (
            <article key={p.id} className="card card-pad stack help-card" style={{ gap: 10, opacity: p.status === 'resolvido' ? 0.7 : 1 }}>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge ${p.kind === 'preciso' ? 'live' : 'ok'}`}>{p.kind === 'preciso' ? 'Preciso' : 'Ofereço'}</span>
                <span className="badge">{catLabel(p.category)}</span>
                <span className="grow" />
                {(filtro !== 'mural' || p.status === 'resolvido') && <span className={`badge ${stTone}`}>{stLabel}</span>}
              </div>
              <h3 style={{ fontSize: 17, fontWeight: 650 }}>{p.title}</h3>
              {p.body && <p className="pre small" style={{ color: 'var(--ink-2)' }}>{p.body}</p>}
              {p.status === 'recusado' && p.review_note && <div className="alert warn small">{p.review_note}</div>}
              <div className="row">
                <Avatar name={p.author_name} picture={p.author_picture} size={28} />
                <div className="grow small">
                  <span style={{ fontWeight: 600 }}>{p.author_name ?? 'Membro'}</span> <span className="muted">· {ago(p.created_at)}</span>
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {p.status === 'aprovado' && !mine && contact && (
                  <a className="btn btn-gold btn-sm" href={contact.href} target="_blank" rel="noreferrer">
                    {contact.icon} {contact.label}
                  </a>
                )}
                {p.status === 'aprovado' && !mine && p.contact && !contact && <span className="small">Contato: {p.contact}</span>}
                {isLeader && p.status === 'pendente' && (
                  <>
                    <Button size="sm" variant="ok" icon={<Check />} onClick={() => void act(() => api(`/ajuda/${p.id}/moderar`, { method: 'POST', body: { status: 'aprovado' } }), 'Aprovado e publicado no mural.')}>
                      Aprovar
                    </Button>
                    <Button size="sm" variant="ghost" icon={<X />} onClick={() => setRefusing(p)}>
                      Recusar
                    </Button>
                  </>
                )}
                <span className="grow" />
                {mine && (p.status === 'aprovado' || p.status === 'resolvido') && (
                  <Button size="sm" variant="secondary" icon={<CheckCircle2 />} onClick={() => void act(() => api(`/ajuda/${p.id}/resolvido`, { method: 'POST', body: {} }))}>
                    {p.status === 'resolvido' ? 'Reabrir' : 'Já resolvi'}
                  </Button>
                )}
                {mine && (
                  <button className="icon-btn" aria-label="Editar" onClick={() => setEdit(p)}>
                    <Pencil size={19} />
                  </button>
                )}
                {(mine || isLeader) && (
                  <button
                    className="icon-btn"
                    aria-label="Apagar"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Apagar esta publicação?', confirmLabel: 'Apagar', danger: true }))) return;
                      void act(() => api(`/ajuda/${p.id}`, { method: 'DELETE' }), 'Apagada.');
                    }}
                  >
                    <Trash2 size={19} />
                  </button>
                )}
              </div>
            </article>
          );
        })
      ) : (
        <Empty
          icon={<HandHelping />}
          title={filtro === 'pendentes' ? 'Nada para aprovar' : filtro === 'meus' ? 'Você ainda não publicou' : 'O mural está vazio'}
          text={filtro === 'mural' ? 'Seja o primeiro a oferecer ou pedir ajuda.' : undefined}
        />
      )}
      {edit && <HelpSheet post={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={(pending) => {
        void reload();
        if (pending && filtro !== 'meus') setParams({ filtro: 'meus' }, { replace: true });
      }} />}
      {refusing && <RefuseSheet post={refusing} onClose={() => setRefusing(null)} onDone={() => void reload()} />}
    </div>
  );
}

function HelpSheet({ post, onClose, onDone }: { post?: HelpPost; onClose: () => void; onDone: (pending: boolean) => void }) {
  const { user, isLeader } = useSession();
  const [kind, setKind] = useState<HelpKind>(post?.kind ?? 'preciso');
  const [category, setCategory] = useState(post?.category ?? 'outros');
  const [title, setTitle] = useState(post?.title ?? '');
  const [body, setBody] = useState(post?.body ?? '');
  const [contact, setContact] = useState(post?.contact ?? user?.phone ?? '');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={post ? 'Editar publicação' : 'Publicar no mural'}
      onClose={onClose}
      footer={
        <Button
          loading={busy}
          block
          onClick={() =>
            void run(async () => {
              const payload = { kind, category, title, body, contact };
              const r = post
                ? await api<{ status: string }>(`/ajuda/${post.id}`, { method: 'PUT', body: payload })
                : await api<{ status: string }>('/ajuda', { method: 'POST', body: payload });
              toast(r.status === 'pendente' ? 'Enviado! A liderança vai aprovar antes de aparecer no mural.' : 'Publicado no mural.', 'ok');
              onDone(r.status === 'pendente');
              onClose();
            })
          }
        >
          {post ? 'Salvar' : isLeader ? 'Publicar' : 'Enviar para aprovação'}
        </Button>
      }
    >
      <div className="stack">
        <Seg
          value={kind}
          onChange={setKind}
          options={[
            { value: 'preciso', label: 'Preciso de ajuda' },
            { value: 'ofereco', label: 'Quero ajudar' },
          ]}
        />
        <div>
          <div className="small" style={{ fontWeight: 620, marginBottom: 6 }}>
            Categoria
          </div>
          <Chips value={category} onChange={setCategory} options={HELP_CATEGORIES} wrap />
        </div>
        <TextField
          label="Título"
          value={title}
          onChange={setTitle}
          maxLength={100}
          placeholder={kind === 'preciso' ? 'Ex.: Procuro vaga de auxiliar administrativo' : 'Ex.: Sou eletricista, posso ajudar irmãos'}
        />
        <TextField label="Detalhes (opcional)" value={body} onChange={setBody} multiline rows={4} maxLength={1500} />
        <TextField
          label="Contato"
          value={contact}
          onChange={setContact}
          maxLength={120}
          placeholder="WhatsApp ou e-mail"
          hint="Aparece para os membros quando a publicação for aprovada. Deixe vazio para ser procurado(a) pela liderança."
        />
        {!isLeader && <div className="small muted">A liderança revisa as publicações antes de irem para o mural, para cuidar de todos.</div>}
      </div>
    </Sheet>
  );
}

function RefuseSheet({ post, onClose, onDone }: { post: HelpPost; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      small
      title="Recusar publicação"
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          loading={busy}
          block
          onClick={() =>
            void run(async () => {
              await api(`/ajuda/${post.id}/moderar`, { method: 'POST', body: { status: 'recusado', note } });
              onDone();
              onClose();
            }, 'Publicação recusada.')
          }
        >
          Recusar
        </Button>
      }
    >
      <div className="stack">
        <div className="small">
          <strong>{post.title}</strong>
        </div>
        <TextField label="Motivo (a pessoa recebe)" value={note} onChange={setNote} multiline rows={3} maxLength={300} placeholder="Ex.: Vamos conversar pessoalmente sobre isso." />
      </div>
    </Sheet>
  );
}
