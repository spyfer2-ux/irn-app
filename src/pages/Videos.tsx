import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Clapperboard, EyeOff, Film, Link2, Pencil, Plus, RefreshCw, Search, Share2, Trash2, Upload } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Video } from '../lib/types';
import { ago, bytes, duration, longDate, parts } from '../lib/format';
import { readVideoMeta, uploadVideo } from '../lib/upload';
import { share } from '../lib/ics';
import {
  Button,
  Chips,
  confirmDialog,
  Empty,
  ErrorBox,
  LoadingList,
  mediaUrl,
  Page,
  SelectField,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';
import { VideoCard } from '../components/cards';

const CATEGORIES = ['Cultos e pregações', 'Louvor', 'Rede Jovem', 'Testemunhos', 'Estudos', 'Eventos', 'Avisos', 'Vídeos curtos'];

interface VideoList {
  videos: Video[];
  next: number | null;
  categories: { category: string; n: number }[];
}

export default function Videos() {
  const { isMedia } = useSession();
  const [fonte, setFonte] = useState<'todos' | 'youtube' | 'upload'>('todos');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const qs = new URLSearchParams();
  if (fonte !== 'todos') qs.set('fonte', fonte);
  if (cat) qs.set('categoria', cat);
  if (query) qs.set('q', query);
  if (isMedia) qs.set('ocultos', '1');
  const { data, error, loading, reload } = useApi<VideoList>(`/videos?${qs}`);
  const [more, setMore] = useState<Video[]>([]);
  const [next, setNext] = useState<number | null>(null);
  useEffect(() => {
    setMore([]);
    setNext(data?.next ?? null);
  }, [data]);
  const loadMore = async () => {
    if (!next) return;
    const r = await api<VideoList>(`/videos?${qs}&antes=${next}`);
    setMore((m) => [...m, ...r.videos]);
    setNext(r.next);
  };
  const list = [...(data?.videos ?? []), ...more];

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Page
      title="Vídeos"
      actions={
        isMedia ? (
          <Button size="sm" icon={<Plus />} onClick={() => setAdding(true)}>
            Adicionar
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="row" style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 14, color: 'var(--ink-3)' }} />
          <input className="input" style={{ paddingLeft: 40 }} placeholder="Buscar vídeo ou pregador" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar vídeos" />
        </div>
        <Link to="/cenas" className="card card-pad scenes-banner">
          <span className="icon-tile gold">
            <Clapperboard />
          </span>
          <div className="grow">
            <div style={{ fontWeight: 700 }}>Cenas que pregam</div>
            <div className="small muted">Trechos de The Chosen com a passagem da Bíblia e perguntas para a célula.</div>
          </div>
        </Link>
        <Chips
          value={fonte}
          onChange={setFonte}
          options={[
            { value: 'todos', label: 'Todos' },
            { value: 'youtube', label: 'Cultos (YouTube)' },
            { value: 'upload', label: 'Vídeos do app' },
          ]}
        />
        {data && data.categories.length > 1 && (
          <Chips
            value={cat}
            onChange={setCat}
            options={[{ value: '', label: 'Todas as categorias' }, ...data.categories.map((c) => ({ value: c.category, label: c.category }))]}
          />
        )}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList n={4} h={190} />
        ) : list.length ? (
          <div className="video-grid">
            {list.map((v) => (
              <div key={v.id} style={{ opacity: v.hidden ? 0.5 : 1 }}>
                <VideoCard v={v} />
                {v.hidden ? <span className="badge mt-1">Oculto</span> : null}
              </div>
            ))}
          </div>
        ) : (
          <Empty icon={<Film />} title="Nenhum vídeo aqui ainda" text={isMedia ? 'Adicione um link do YouTube ou envie um vídeo curto.' : 'Volte em breve!'} />
        )}
        {next && (
          <Button variant="secondary" onClick={() => void loadMore().catch(toastError)}>
            Carregar mais
          </Button>
        )}
      </div>
      {adding && <AddVideoSheet onClose={() => setAdding(false)} onDone={() => void reload()} />}
    </Page>
  );
}

function AddVideoSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { features } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'youtube' | 'upload' | 'sync'>('youtube');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [speaker, setSpeaker] = useState('');
  const [desc, setDesc] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    setCategory((c) => (mode === 'upload' && c === CATEGORIES[0] ? 'Vídeos curtos' : mode === 'youtube' && c === 'Vídeos curtos' ? CATEGORIES[0] : c));
  }, [mode]);

  const save = () =>
    run(async () => {
      if (mode === 'youtube') {
        const r = await api<{ id: number }>('/videos/youtube', {
          method: 'POST',
          body: { url, title, category, speaker, description: desc, visibility: isPublic ? 'public' : 'members' },
        });
        toast('Vídeo adicionado!', 'ok');
        onDone();
        onClose();
        navigate(`/videos/${r.id}`);
      } else if (mode === 'upload') {
        if (!file) throw new Error('Escolha um vídeo.');
        if (!title.trim()) throw new Error('Dê um título ao vídeo.');
        abort.current = new AbortController();
        setProgress(0);
        const meta = await readVideoMeta(file);
        const access = isPublic ? 'public' : 'members';
        const up = await uploadVideo(file, meta, access, setProgress, abort.current.signal);
        const r = await api<{ id: number }>('/videos/upload', {
          method: 'POST',
          body: { media_id: up.mediaId, poster_id: up.posterId, title, category, speaker, description: desc, visibility: access },
        });
        toast('Vídeo enviado!', 'ok');
        onDone();
        onClose();
        navigate(`/videos/${r.id}`);
      } else {
        const r = await api<{ added: number }>('/videos/sincronizar', { method: 'POST' });
        toast(r.added ? `${r.added} vídeo(s) novo(s) do canal.` : 'Nenhum vídeo novo no canal.', 'ok');
        onDone();
        onClose();
      }
    }).finally(() => setProgress(null));

  return (
    <Sheet
      open
      title="Adicionar vídeo"
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      footer={
        <Button block loading={busy} onClick={() => void save()} icon={mode === 'upload' ? <Upload /> : mode === 'sync' ? <RefreshCw /> : <Link2 />}>
          {mode === 'youtube' ? 'Adicionar' : mode === 'upload' ? 'Enviar vídeo' : 'Buscar vídeos novos'}
        </Button>
      }
    >
      <div className="stack">
        <Chips
          value={mode}
          onChange={setMode}
          options={[
            { value: 'youtube', label: 'Link do YouTube' },
            { value: 'upload', label: 'Enviar do celular' },
            { value: 'sync', label: 'Canal da igreja' },
          ]}
        />
        {mode === 'sync' ? (
          <p className="small" style={{ color: 'var(--ink-2)' }}>
            O app já busca sozinho, a cada hora, os vídeos novos do canal da igreja no YouTube. Use este botão para buscar agora.
          </p>
        ) : (
          <>
            {mode === 'youtube' ? (
              <TextField label="Link do vídeo" value={url} onChange={setUrl} placeholder="https://youtu.be/…" inputMode="url" hint="Abra o vídeo no YouTube → Compartilhar → Copiar link." />
            ) : !features.video_upload ? (
              <div className="alert warn">
                <Upload />
                <div>Para enviar vídeos pelo app, o administrador precisa ativar o armazenamento R2 na Cloudflare (veja Administração → Configurações).</div>
              </div>
            ) : (
              <div className="field">
                <span className="field-label">Arquivo de vídeo</span>
                <button type="button" className="dropzone" onClick={() => input.current?.click()} disabled={progress !== null}>
                  <Film />
                  <span className="small">{file ? `${file.name} · ${bytes(file.size)}` : 'Toque para escolher um vídeo (até 600 MB)'}</span>
                </button>
                <input
                  ref={input}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm,video/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f && f.size > 600 * 1024 * 1024) return toast('Vídeo muito grande (máximo 600 MB). Para cultos inteiros, use o YouTube.', 'error');
                    setFile(f);
                    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
                  }}
                />
                <div className="hint">Dica para iPhone: Ajustes → Câmera → Formatos → "Mais Compatível", para o vídeo abrir em todos os celulares.</div>
                {progress !== null && (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="progress">
                      <div style={{ width: `${Math.round(progress * 100)}%` }} />
                    </div>
                    <div className="small muted">Enviando… {Math.round(progress * 100)}% — não feche esta tela.</div>
                  </div>
                )}
              </div>
            )}
            <TextField label={mode === 'youtube' ? 'Título (deixe vazio para usar o do YouTube)' : 'Título'} value={title} onChange={setTitle} maxLength={200} />
            <div className="form-grid collapse">
              <SelectField label="Categoria" value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              <TextField label="Pregador (opcional)" value={speaker} onChange={setSpeaker} maxLength={80} />
            </div>
            <TextField label="Descrição (opcional)" value={desc} onChange={setDesc} multiline rows={3} maxLength={2000} />
            <Toggle label="Público" hint={isPublic ? 'Visitantes também veem.' : 'Só membros aprovados veem.'} checked={isPublic} onChange={setIsPublic} />
          </>
        )}
      </div>
    </Sheet>
  );
}

export function VideoDetail() {
  const { id } = useParams();
  const { isMedia } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ video: Video }>(`/videos/${id}`);
  const [editing, setEditing] = useState(false);
  const v = data?.video;

  return (
    <Page
      title={v?.title ?? 'Vídeo'}
      back="/videos"
      actions={
        v && (
          <button
            className="icon-btn"
            aria-label="Compartilhar"
            onClick={async () => {
              const r = await share(v.title, `Assista: ${v.title}`, `/videos/${v.id}`);
              if (r === 'copied') toast('Link copiado!', 'ok');
            }}
          >
            <Share2 />
          </button>
        )
      }
    >
      {error && <ErrorBox error={error} retry={reload} />}
      {v && (
        <div className="stack">
          <div className="player player-full">
            {v.source === 'youtube' ? (
              <iframe
                src={`https://www.youtube.com/embed/${v.youtube_id}?playsinline=1&rel=0`}
                title={v.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <video src={mediaUrl(v.media_id!)} poster={v.poster_id ? mediaUrl(v.poster_id) : undefined} controls playsInline preload="metadata" />
            )}
          </div>
          <div>
            <h2 style={{ fontSize: 20 }}>{v.title}</h2>
            <div className="small muted mt-1">
              {[v.category, v.speaker, longDate(parts(v.published_at).ymd), v.duration ? duration(v.duration) : ''].filter(Boolean).join(' · ')}
            </div>
            <div className="wrap-row mt-1">
              {v.visibility === 'members' && <span className="badge blue">Só membros</span>}
              {v.hidden ? (
                <span className="badge">
                  <EyeOff size={12} /> Oculto
                </span>
              ) : null}
            </div>
          </div>
          {v.description && <p className="pre" style={{ color: 'var(--ink-2)' }}>{v.description}</p>}
          {v.source === 'upload' && (
            <a className="btn btn-secondary" href={`${mediaUrl(v.media_id!)}?baixar=1`}>
              Baixar vídeo
            </a>
          )}
          {isMedia && (
            <div className="row">
              <Button variant="secondary" icon={<Pencil />} onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={async () => {
                  if (!(await confirmDialog({ title: 'Apagar este vídeo do app?', text: v.source === 'youtube' ? 'O vídeo continua no YouTube.' : 'O arquivo será apagado.', confirmLabel: 'Apagar', danger: true }))) return;
                  try {
                    await api(`/videos/${v.id}`, { method: 'DELETE' });
                    toast('Vídeo apagado.', 'ok');
                    navigate('/videos');
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                Apagar
              </Button>
            </div>
          )}
          <div className="tiny muted">Publicado {ago(v.published_at)}</div>
        </div>
      )}
      {editing && v && <EditVideoSheet v={v} onClose={() => setEditing(false)} onDone={() => void reload()} />}
    </Page>
  );
}

function EditVideoSheet({ v, onClose, onDone }: { v: Video; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(v.title);
  const [category, setCategory] = useState(v.category ?? CATEGORIES[0]);
  const [speaker, setSpeaker] = useState(v.speaker ?? '');
  const [desc, setDesc] = useState(v.description ?? '');
  const [isPublic, setIsPublic] = useState(v.visibility === 'public');
  const [hidden, setHidden] = useState(!!v.hidden);
  const { busy, run } = useAction();
  const cats = CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES];
  return (
    <Sheet
      open
      title="Editar vídeo"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api(`/videos/${v.id}`, {
                method: 'PUT',
                body: { title, category, speaker, description: desc, visibility: isPublic ? 'public' : 'members', hidden },
              });
              onDone();
              onClose();
            }, 'Vídeo atualizado.')
          }
        >
          Salvar
        </Button>
      }
    >
      <div className="stack">
        <TextField label="Título" value={title} onChange={setTitle} maxLength={200} />
        <SelectField label="Categoria" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} />
        <TextField label="Pregador" value={speaker} onChange={setSpeaker} maxLength={80} />
        <TextField label="Descrição" value={desc} onChange={setDesc} multiline rows={4} maxLength={2000} />
        <Toggle label="Público" hint={isPublic ? 'Visitantes também veem.' : 'Só membros aprovados veem.'} checked={isPublic} onChange={setIsPublic} />
        <Toggle label="Ocultar do app" hint="Some da lista, mas não é apagado." checked={hidden} onChange={setHidden} />
      </div>
    </Sheet>
  );
}
