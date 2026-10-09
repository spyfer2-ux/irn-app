import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderInput,
  FolderPlus,
  ImageIcon,
  Images,
  Loader2,
  Pencil,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Album, Photo } from '../lib/types';
import { ago, longDate, shortDate } from '../lib/format';
import { preparePhoto } from '../lib/image';
import { uploadImage } from '../lib/upload';
import {
  Button,
  confirmDialog,
  Empty,
  ErrorBox,
  LoadingList,
  MediaImg,
  MembersOnly,
  mediaUrl,
  Page,
  Section,
  SelectField,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';

interface AlbumsResp {
  albums: Album[];
  loose: { count: number; thumb: string | null };
  total: number;
}
interface PhotosResp {
  photos: Photo[];
  next: number | null;
}

// ---------------- grade com carregamento contínuo ----------------

function usePhotoFeed(album: string) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(
    async (reset: boolean, cursor?: number | null) => {
      setLoading(true);
      try {
        const r = await api<PhotosResp>(`/fotos?album=${album}&limite=60${!reset && cursor ? `&antes=${cursor}` : ''}`);
        setPhotos((p) => (reset ? r.photos : [...p, ...r.photos]));
        setNext(r.next);
        setError(null);
      } catch (e) {
        setError(e);
      } finally {
        setLoading(false);
      }
    },
    [album],
  );
  useEffect(() => {
    void load(true);
  }, [load]);
  return { photos, setPhotos, next, loading, error, reload: () => load(true), more: () => load(false, next) };
}

function PhotoGrid({ photos, onOpen, next, onMore, loading }: { photos: Photo[]; onOpen: (i: number) => void; next: number | null; onMore: () => void; loading: boolean }) {
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!next || !sentinel.current) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && !loading && onMore(), { rootMargin: '600px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [next, loading, onMore]);
  return (
    <>
      <div className="photo-grid">
        {photos.map((p, i) => (
          <button key={p.id} onClick={() => onOpen(i)} aria-label={p.caption ?? `Foto ${i + 1}`}>
            <MediaImg id={p.thumb_id} alt={p.caption ?? ''} />
          </button>
        ))}
      </div>
      {next && (
        <div ref={sentinel} className="center mt-2">
          {loading ? <Loader2 className="spin" style={{ margin: '0 auto', color: 'var(--ink-3)' }} /> : null}
        </div>
      )}
    </>
  );
}

// ---------------- biblioteca ----------------

export default function Photos() {
  return (
    <MembersOnly text="A biblioteca de fotos é só para os membros da igreja. Entre com sua conta Google e aguarde a aprovação.">
      <PhotosInner />
    </MembersOnly>
  );
}

function PhotosInner() {
  const { isMedia } = useSession();
  const albums = useApi<AlbumsResp>('/fotos/albums');
  const feed = usePhotoFeed('todas');
  const [viewer, setViewer] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [newAlbum, setNewAlbum] = useState(false);

  const refresh = () => {
    void albums.reload();
    void feed.reload();
  };

  return (
    <Page
      title="Fotos"
      actions={
        <Button size="sm" icon={<Upload />} onClick={() => setUploading(true)}>
          Enviar
        </Button>
      }
    >
      <div className="stack-lg">
        <Section
          title="Álbuns"
          action={
            isMedia ? (
              <button className="link-btn row" style={{ gap: 4 }} onClick={() => setNewAlbum(true)}>
                <FolderPlus size={16} /> Novo álbum
              </button>
            ) : undefined
          }
        >
          {albums.error ? (
            <ErrorBox error={albums.error} retry={albums.reload} />
          ) : !albums.data ? (
            <LoadingList n={1} h={140} />
          ) : albums.data.albums.length || albums.data.loose.count ? (
            <div className="album-grid">
              {albums.data.albums.map((a) => (
                <AlbumCard key={a.id} to={`/fotos/album/${a.id}`} title={a.title} thumb={a.cover_thumb_id} sub={`${a.photo_count} foto${a.photo_count === 1 ? '' : 's'}${a.event_date ? ` · ${shortDate(a.event_date)}` : ''}`} />
              ))}
              {albums.data.loose.count > 0 && (
                <AlbumCard to="/fotos/album/avulsas" title="Fotos avulsas" thumb={albums.data.loose.thumb} sub={`${albums.data.loose.count} foto${albums.data.loose.count === 1 ? '' : 's'}`} />
              )}
            </div>
          ) : (
            <p className="small muted">Ainda não há álbuns.</p>
          )}
        </Section>

        <Section title={`Todas as fotos${albums.data ? ` (${albums.data.total})` : ''}`}>
          {feed.error ? <ErrorBox error={feed.error} retry={feed.reload} /> : null}
          {!feed.photos.length && feed.loading ? (
            <LoadingList n={2} h={120} />
          ) : feed.photos.length ? (
            <PhotoGrid photos={feed.photos} onOpen={setViewer} next={feed.next} onMore={feed.more} loading={feed.loading} />
          ) : (
            <Empty
              icon={<Camera />}
              title="Nenhuma foto ainda"
              text="Seja o primeiro a compartilhar as fotos dos cultos e eventos!"
              action={
                <Button icon={<Upload />} onClick={() => setUploading(true)}>
                  Enviar fotos
                </Button>
              }
            />
          )}
        </Section>
      </div>

      {viewer !== null && (
        <Viewer
          photos={feed.photos}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onChanged={(p) => feed.setPhotos((list) => list.map((x) => (x.id === p.id ? p : x)))}
          onDeleted={(id) => {
            feed.setPhotos((list) => list.filter((x) => x.id !== id));
            void albums.reload();
          }}
          albums={albums.data?.albums ?? []}
        />
      )}
      {uploading && <UploadSheet albums={albums.data?.albums ?? []} onClose={() => setUploading(false)} onDone={refresh} />}
      {newAlbum && <AlbumSheet onClose={() => setNewAlbum(false)} onDone={() => void albums.reload()} />}
    </Page>
  );
}

function AlbumCard({ to, title, thumb, sub }: { to: string; title: string; thumb: string | null; sub: string }) {
  return (
    <Link to={to} className="album-card">
      <div className="album-cover">{thumb ? <MediaImg id={thumb} /> : <Images />}</div>
      <div style={{ fontWeight: 620, marginTop: 7, lineHeight: 1.25 }} className="clamp-2">
        {title}
      </div>
      <div className="tiny muted">{sub}</div>
    </Link>
  );
}

// ---------------- página do álbum ----------------

export function AlbumPage() {
  return (
    <MembersOnly>
      <AlbumInner />
    </MembersOnly>
  );
}

function AlbumInner() {
  const { id = 'avulsas' } = useParams();
  const { isMedia } = useSession();
  const navigate = useNavigate();
  const albums = useApi<AlbumsResp>('/fotos/albums');
  const feed = usePhotoFeed(id);
  const [viewer, setViewer] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const album = albums.data?.albums.find((a) => String(a.id) === id);
  const title = id === 'avulsas' ? 'Fotos avulsas' : album?.title ?? 'Álbum';
  const canUpload = id === 'avulsas' || !album || album.members_can_upload || isMedia;

  return (
    <Page
      title={title}
      back="/fotos"
      actions={
        <>
          {isMedia && album && (
            <button className="icon-btn" aria-label="Editar álbum" onClick={() => setEditing(true)}>
              <Pencil />
            </button>
          )}
          {canUpload && (
            <Button size="sm" icon={<Upload />} onClick={() => setUploading(true)}>
              Enviar
            </Button>
          )}
        </>
      }
    >
      <div className="stack">
        {album && (album.description || album.event_date) && (
          <div className="small" style={{ color: 'var(--ink-2)' }}>
            {album.event_date && <div style={{ fontWeight: 600 }}>{longDate(album.event_date)}</div>}
            {album.description && <p className="pre">{album.description}</p>}
          </div>
        )}
        {feed.error ? <ErrorBox error={feed.error} retry={feed.reload} /> : null}
        {!feed.photos.length && feed.loading ? (
          <LoadingList n={2} h={120} />
        ) : feed.photos.length ? (
          <PhotoGrid photos={feed.photos} onOpen={setViewer} next={feed.next} onMore={feed.more} loading={feed.loading} />
        ) : (
          <Empty icon={<ImageIcon />} title="Álbum vazio" text={canUpload ? 'Envie as primeiras fotos.' : 'A equipe de mídia ainda vai publicar as fotos.'} />
        )}
      </div>
      {viewer !== null && (
        <Viewer
          photos={feed.photos}
          index={viewer}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
          onChanged={(p) => {
            if (String(p.album_id ?? 'avulsas') !== id) feed.setPhotos((l) => l.filter((x) => x.id !== p.id));
            else feed.setPhotos((l) => l.map((x) => (x.id === p.id ? p : x)));
          }}
          onDeleted={(pid) => feed.setPhotos((l) => l.filter((x) => x.id !== pid))}
          albums={albums.data?.albums ?? []}
          coverAlbumId={isMedia && album ? album.id : undefined}
          onCover={() => void albums.reload()}
        />
      )}
      {uploading && (
        <UploadSheet
          albums={albums.data?.albums ?? []}
          fixedAlbum={id === 'avulsas' ? null : Number(id)}
          onClose={() => setUploading(false)}
          onDone={() => {
            void feed.reload();
            void albums.reload();
          }}
        />
      )}
      {editing && album && (
        <AlbumSheet
          album={album}
          onClose={() => setEditing(false)}
          onDone={() => void albums.reload()}
          onDeleted={() => navigate('/fotos')}
        />
      )}
    </Page>
  );
}

// ---------------- visualizador ----------------

function Viewer({
  photos,
  index,
  onIndex,
  onClose,
  onChanged,
  onDeleted,
  albums,
  coverAlbumId,
  onCover,
}: {
  photos: Photo[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onChanged: (p: Photo) => void;
  onDeleted: (id: number) => void;
  albums: Album[];
  coverAlbumId?: number;
  onCover?: () => void;
}) {
  const { user, isMedia } = useSession();
  const p = photos[index];
  const start = useRef<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const go = useCallback(
    (d: number) => {
      const n = index + d;
      if (n >= 0 && n < photos.length) onIndex(n);
    },
    [index, photos.length, onIndex],
  );

  useEffect(() => {
    setLoaded(false);
  }, [p?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editing) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose, editing]);

  // pré-carrega a próxima
  useEffect(() => {
    const n = photos[index + 1];
    if (n) new Image().src = mediaUrl(n.media_id);
  }, [index, photos]);

  if (!p) return null;
  const mine = user && p.uploaded_by === user.id;
  const canEdit = mine || isMedia;

  const shareIt = async () => {
    try {
      const blob = await (await fetch(mediaUrl(p.media_id))).blob();
      const file = new File([blob], `foto-irn-${p.id}.jpg`, { type: blob.type || 'image/jpeg' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: p.caption ?? 'Foto da IRN' });
        return;
      }
      toast('Seu navegador não compartilha imagens. Use "Baixar".');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toastError(e);
    }
  };

  const del = async () => {
    if (!(await confirmDialog({ title: 'Apagar esta foto?', text: 'Ela sai da biblioteca para todos.', confirmLabel: 'Apagar', danger: true }))) return;
    try {
      await api(`/fotos/${p.id}`, { method: 'DELETE' });
      toast('Foto apagada.', 'ok');
      onDeleted(p.id);
      if (photos.length <= 1) onClose();
      else if (index >= photos.length - 1) onIndex(index - 1);
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <div
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Foto"
      onPointerDown={(e) => (start.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const s = start.current;
        start.current = null;
        if (!s || editing) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) onClose();
      }}
    >
      <div className="viewer-top">
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          <X />
        </button>
        <div className="grow small" style={{ opacity: 0.85 }}>
          {index + 1} de {photos.length}
        </div>
        <button className="icon-btn" onClick={() => void shareIt()} aria-label="Compartilhar">
          <Share2 />
        </button>
        <a className="icon-btn" href={`${mediaUrl(p.media_id)}?baixar=1`} aria-label="Baixar" download>
          <Download />
        </a>
        {canEdit && (
          <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Editar">
            <Pencil />
          </button>
        )}
        {canEdit && (
          <button className="icon-btn" onClick={() => void del()} aria-label="Apagar">
            <Trash2 />
          </button>
        )}
      </div>
      <div className="viewer-stage">
        <img
          key={p.id}
          src={mediaUrl(p.media_id)}
          alt={p.caption ?? ''}
          onLoad={() => setLoaded(true)}
          style={{
            backgroundImage: loaded ? undefined : `url(${mediaUrl(p.thumb_id)})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            minWidth: loaded ? undefined : '60vw',
            minHeight: loaded ? undefined : '40vh',
          }}
          draggable={false}
        />
      </div>
      {index > 0 && (
        <button className="icon-btn viewer-nav l" onClick={() => go(-1)} aria-label="Anterior">
          <ChevronLeft />
        </button>
      )}
      {index < photos.length - 1 && (
        <button className="icon-btn viewer-nav r" onClick={() => go(1)} aria-label="Próxima">
          <ChevronRight />
        </button>
      )}
      <div className="viewer-bottom">
        {p.caption && <div style={{ fontWeight: 600 }}>{p.caption}</div>}
        <div className="small" style={{ opacity: 0.8 }}>
          {p.uploader_name ? `Enviada por ${p.uploader_name}` : 'Enviada por um membro'} · {ago(p.created_at)}
          {p.album_title ? ` · ${p.album_title}` : ''}
        </div>
        {coverAlbumId && (
          <div>
            <button
              className="btn btn-glass btn-sm mt-1"
              onClick={async () => {
                try {
                  await api(`/fotos/albums/${coverAlbumId}/cover`, { method: 'POST', body: { photo_id: p.id } });
                  toast('Capa do álbum atualizada.', 'ok');
                  onCover?.();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              <Star /> Usar como capa do álbum
            </button>
          </div>
        )}
      </div>
      {editing && (
        <EditPhotoSheet
          photo={p}
          albums={albums}
          onClose={() => setEditing(false)}
          onSaved={(np) => {
            onChanged(np);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}

function EditPhotoSheet({ photo, albums, onClose, onSaved }: { photo: Photo; albums: Album[]; onClose: () => void; onSaved: (p: Photo) => void }) {
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [album, setAlbum] = useState(photo.album_id ? String(photo.album_id) : '');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title="Editar foto"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          icon={<FolderInput />}
          onClick={() =>
            void run(async () => {
              await api(`/fotos/${photo.id}`, { method: 'PATCH', body: { caption, album_id: album ? Number(album) : null } });
              const a = albums.find((x) => String(x.id) === album);
              onSaved({ ...photo, caption: caption || null, album_id: album ? Number(album) : null, album_title: a?.title ?? null });
            }, 'Foto atualizada.')
          }
        >
          Salvar
        </Button>
      }
    >
      <div className="stack">
        <TextField label="Legenda" value={caption} onChange={setCaption} maxLength={300} />
        <SelectField label="Álbum" value={album} onChange={setAlbum} options={[{ value: '', label: 'Sem álbum (fotos avulsas)' }, ...albums.map((a) => ({ value: String(a.id), label: a.title }))]} />
      </div>
    </Sheet>
  );
}

// ---------------- envio de fotos ----------------

interface Item {
  key: string;
  file: File;
  preview: string;
  state: 'fila' | 'enviando' | 'ok' | 'erro';
  error?: string;
}

function UploadSheet({ albums, fixedAlbum, onClose, onDone }: { albums: Album[]; fixedAlbum?: number | null; onClose: () => void; onDone: () => void }) {
  const { features, isMedia } = useSession();
  const [items, setItems] = useState<Item[]>([]);
  const [album, setAlbum] = useState(fixedAlbum ? String(fixedAlbum) : '');
  const [caption, setCaption] = useState('');
  const [running, setRunning] = useState(false);
  const [drag, setDrag] = useState(false);
  const [consent, setConsent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
      items.forEach((i) => URL.revokeObjectURL(i.preview));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (list.length < (files as FileList).length) toast('Alguns arquivos não são imagens e foram ignorados.');
    setItems((cur) => [
      ...cur,
      ...list.slice(0, 200 - cur.length).map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, preview: URL.createObjectURL(file), state: 'fila' as const })),
    ]);
  };

  const uploadable = albums.filter((a) => a.members_can_upload || isMedia);
  const done = items.filter((i) => i.state === 'ok').length;
  const pending = items.filter((i) => i.state === 'fila' || i.state === 'erro');

  const start = async () => {
    if (!consent) return toast('Confirme que as pessoas das fotos concordam em aparecer.', 'error');
    setRunning(true);
    cancelled.current = false;
    const queue = items.filter((i) => i.state !== 'ok');
    let okCount = 0;
    const worker = async () => {
      while (queue.length && !cancelled.current) {
        const it = queue.shift()!;
        setItems((l) => l.map((x) => (x.key === it.key ? { ...x, state: 'enviando', error: undefined } : x)));
        try {
          const { full, thumb } = await preparePhoto(it.file, features.storage);
          const mediaId = await uploadImage(full, 'photo');
          const thumbId = await uploadImage(thumb, 'thumb');
          await api('/fotos', {
            method: 'POST',
            body: { album_id: album ? Number(album) : null, media_id: mediaId, thumb_id: thumbId, width: full.width, height: full.height, caption },
          });
          okCount++;
          setItems((l) => l.map((x) => (x.key === it.key ? { ...x, state: 'ok' } : x)));
        } catch (e) {
          setItems((l) => l.map((x) => (x.key === it.key ? { ...x, state: 'erro', error: (e as Error).message } : x)));
        }
      }
    };
    await Promise.all([worker(), worker()]);
    setRunning(false);
    if (okCount) {
      void api('/fotos/anunciar', { method: 'POST', body: { album_id: album ? Number(album) : null, count: okCount } }).catch(() => undefined);
      onDone();
    }
  };

  const allDone = items.length > 0 && done === items.length;

  return (
    <Sheet
      open
      title="Enviar fotos"
      onClose={() => {
        cancelled.current = true;
        onClose();
      }}
      footer={
        allDone ? (
          <Button block variant="ok" icon={<Check />} onClick={onClose}>
            Pronto! {done} foto{done === 1 ? '' : 's'} enviada{done === 1 ? '' : 's'}
          </Button>
        ) : (
          <Button block loading={running} disabled={!pending.length} icon={<Upload />} onClick={() => void start()}>
            {running ? `Enviando ${done} de ${items.length}…` : items.length ? `Enviar ${pending.length} foto${pending.length === 1 ? '' : 's'}` : 'Escolha as fotos'}
          </Button>
        )
      }
    >
      <div className="stack">
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => !running && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
        >
          <Camera />
          <span style={{ fontWeight: 600 }}>Escolher fotos da galeria</span>
          <span className="tiny muted">Pode selecionar várias de uma vez. O app reduz o tamanho antes de enviar.</span>
        </div>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }} />
        {items.length > 0 && (
          <div className="upload-list">
            {items.map((it) => (
              <div key={it.key} className="upload-item" title={it.error}>
                <img src={it.preview} alt="" />
                {it.state !== 'fila' && (
                  <div className={`state ${it.state === 'ok' ? 'ok' : it.state === 'erro' ? 'err' : ''}`}>
                    {it.state === 'enviando' ? <Loader2 className="spin" /> : it.state === 'ok' ? <Check /> : <X />}
                  </div>
                )}
                {it.state === 'fila' && !running && (
                  <button className="rm" aria-label="Tirar da lista" onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))}>
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {items.some((i) => i.state === 'erro') && (
          <div className="alert danger small">
            <X />
            <span>{items.find((i) => i.state === 'erro')?.error ?? 'Algumas fotos falharam.'} Toque em enviar para tentar de novo.</span>
          </div>
        )}
        {fixedAlbum === undefined && (
          <SelectField label="Álbum" value={album} onChange={setAlbum} options={[{ value: '', label: 'Sem álbum (fotos avulsas)' }, ...uploadable.map((a) => ({ value: String(a.id), label: a.title }))]} />
        )}
        <TextField label="Legenda (opcional, vale para todas)" value={caption} onChange={setCaption} maxLength={300} />
        <Toggle
          label="As pessoas que aparecem concordam em ter a foto no app da igreja."
          hint="Fotos de crianças só com autorização dos responsáveis."
          checked={consent}
          onChange={setConsent}
        />
      </div>
    </Sheet>
  );
}

// ---------------- criar / editar álbum ----------------

function AlbumSheet({ album, onClose, onDone, onDeleted }: { album?: Album; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const [title, setTitle] = useState(album?.title ?? '');
  const [date, setDate] = useState(album?.event_date ?? '');
  const [desc, setDesc] = useState(album?.description ?? '');
  const [open, setOpen] = useState(album ? !!album.members_can_upload : true);
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={album ? 'Editar álbum' : 'Novo álbum'}
      onClose={onClose}
      footer={
        <>
          {album && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar o álbum?', text: 'As fotos não são apagadas: elas vão para "Fotos avulsas".', confirmLabel: 'Apagar álbum', danger: true }))) return;
                await run(async () => {
                  await api(`/fotos/albums/${album.id}`, { method: 'DELETE' });
                  onDone();
                  onClose();
                  onDeleted?.();
                }, 'Álbum apagado.');
              }}
            >
              Apagar
            </Button>
          )}
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const body = { title, event_date: date || null, description: desc, members_can_upload: open };
                if (album) await api(`/fotos/albums/${album.id}`, { method: 'PUT', body });
                else await api('/fotos/albums', { method: 'POST', body });
                onDone();
                onClose();
              }, album ? 'Álbum salvo.' : 'Álbum criado.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Nome do álbum" value={title} onChange={setTitle} placeholder="Ex.: Culto de Domingo — 12/10" maxLength={100} />
        <TextField label="Data (opcional)" type="date" value={date} onChange={setDate} />
        <TextField label="Descrição (opcional)" value={desc} onChange={setDesc} multiline rows={3} maxLength={500} />
        <Toggle label="Membros podem enviar fotos neste álbum" hint="Desligado: só a equipe de mídia envia." checked={open} onChange={setOpen} />
      </div>
    </Sheet>
  );
}
