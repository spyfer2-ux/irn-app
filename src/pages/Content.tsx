/** Mural de avisos e Palavra do dia. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BookOpen, Megaphone, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Notice, Word } from '../lib/types';
import { longDate, relativeDay, todayYmd } from '../lib/format';
import { helpDrain } from '../lib/push';
import { share } from '../lib/ics';
import {
  Button,
  confirmDialog,
  CoverPicker,
  Empty,
  ErrorBox,
  LoadingList,
  MediaImg,
  Page,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';
import { NoticeCard } from '../components/cards';

// ======================= AVISOS =======================

export function Notices() {
  const { isLeader } = useSession();
  const [all, setAll] = useState(false);
  const { data, error, loading, reload } = useApi<{ notices: Notice[] }>(`/avisos${all ? '?todos=1' : ''}`);
  const [edit, setEdit] = useState<Notice | 'new' | null>(null);
  return (
    <Page
      title="Avisos"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEdit('new')}>
            Aviso
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        {isLeader && <Toggle label="Mostrar avisos vencidos" checked={all} onChange={setAll} />}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.notices.length ? (
          data.notices.map((n) => <NoticeCard key={n.id} n={n} onEdit={isLeader ? () => setEdit(n) : undefined} />)
        ) : (
          <Empty icon={<Megaphone />} title="Nenhum aviso no momento" text="Os recados da liderança aparecem aqui." />
        )}
      </div>
      {edit && <NoticeSheet notice={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => void reload()} />}
    </Page>
  );
}

function NoticeSheet({ notice, onClose, onDone }: { notice?: Notice; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(notice?.title ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [link, setLink] = useState(notice?.link ?? '');
  const [image, setImage] = useState<string | null>(notice?.image_id ?? null);
  const [pinned, setPinned] = useState(!!notice?.pinned);
  const [isPublic, setIsPublic] = useState(notice ? notice.visibility === 'public' : false);
  const [expires, setExpires] = useState(notice?.expires_on ?? '');
  const [notify, setNotify] = useState(false);
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={notice ? 'Editar aviso' : 'Novo aviso'}
      onClose={onClose}
      footer={
        <>
          {notice && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar este aviso?', confirmLabel: 'Apagar', danger: true }))) return;
                await run(async () => {
                  await api(`/avisos/${notice.id}`, { method: 'DELETE' });
                  onDone();
                  onClose();
                }, 'Aviso apagado.');
              }}
            >
              Apagar
            </Button>
          )}
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const payload = { title, body, link, image_id: image, pinned, visibility: isPublic ? 'public' : 'members', expires_on: expires || null, notify };
                if (notice) await api(`/avisos/${notice.id}`, { method: 'PUT', body: payload });
                else await api('/avisos', { method: 'POST', body: payload });
                if (notify && !notice) void helpDrain();
                onDone();
                onClose();
              }, 'Aviso publicado.')
            }
          >
            Publicar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Título" value={title} onChange={setTitle} maxLength={120} />
        <TextField label="Texto" value={body} onChange={setBody} multiline rows={5} maxLength={4000} />
        <TextField label="Link (opcional)" value={link} onChange={setLink} placeholder="https://…" inputMode="url" hint="Ex.: formulário de inscrição, localização, Instagram." />
        <CoverPicker value={image} onChange={setImage} access={isPublic ? 'public' : 'members'} />
        <TextField label="Mostrar até (opcional)" type="date" value={expires} onChange={setExpires} hint="Depois desta data o aviso some sozinho." />
        <Toggle label="Fixar no topo" checked={pinned} onChange={setPinned} />
        <Toggle label="Público" hint={isPublic ? 'Visitantes também veem.' : 'Só membros veem.'} checked={isPublic} onChange={setIsPublic} />
        {!notice && <Toggle label="Avisar por notificação" checked={notify} onChange={setNotify} />}
      </div>
    </Sheet>
  );
}

// ======================= PALAVRA DO DIA =======================

export function Words() {
  const { isLeader } = useSession();
  const { data, error, loading, reload } = useApi<{ words: Word[]; today: string }>(`/palavra${isLeader ? '?futuras=1' : ''}`);
  const [edit, setEdit] = useState<Word | 'new' | null>(null);
  const today = data?.today ?? todayYmd();
  return (
    <Page
      title="Palavra do dia"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEdit('new')}>
            Nova
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.words.length ? (
          data.words.map((w) => (
            <Link key={w.id} to={`/palavra/${w.id}`} className={w.day === today ? 'word-card' : 'card card-pad card-link'}>
              <div className="row-between">
                <span className={w.day === today ? 'kicker' : 'small muted'} style={{ fontWeight: 650 }}>
                  {w.day === today ? 'Hoje' : w.day > today ? `Agendada: ${longDate(w.day)}` : relativeDay(w.day) === 'Hoje' ? 'Hoje' : longDate(w.day)}
                </span>
                {w.day > today && <span className="badge warn">Agendada</span>}
              </div>
              <h3 style={{ fontFamily: 'var(--serif)', fontSize: 19, marginTop: 6, fontWeight: 560 }}>{w.title}</h3>
              {w.reference && <div className="small" style={{ color: 'var(--gold)', fontWeight: 650, marginTop: 4 }}>{w.reference}</div>}
              {w.verse && <p className="small clamp-2 mt-1" style={{ color: 'var(--ink-2)' }}>{w.verse}</p>}
            </Link>
          ))
        ) : (
          <Empty icon={<BookOpen />} title="Nenhuma Palavra publicada ainda" text={isLeader ? 'Publique a primeira — pode agendar para os próximos dias.' : 'Volte amanhã!'} />
        )}
      </div>
      {edit && <WordSheet word={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => void reload()} />}
    </Page>
  );
}

export function WordDetail() {
  const { id } = useParams();
  const { isLeader } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ word: Word }>(`/palavra/${id}`);
  const [editing, setEditing] = useState(false);
  const w = data?.word;
  return (
    <Page
      title="Palavra do dia"
      back="/palavra"
      actions={
        w && (
          <>
            <button
              className="icon-btn"
              aria-label="Compartilhar"
              onClick={async () => {
                const text = `${w.title}${w.reference ? ` (${w.reference})` : ''}${w.verse ? `\n\n${w.verse}` : ''}`;
                const r = await share(w.title, text, `/palavra/${w.id}`);
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
      {w && (
        <article className="stack">
          {w.image_id && <MediaImg id={w.image_id} className="cover" />}
          <div className="small" style={{ color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            {longDate(w.day)}
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 560 }}>{w.title}</h1>
          {w.verse && <blockquote className="verse" style={{ margin: 0 }}>{w.verse}</blockquote>}
          {w.reference && <div style={{ fontWeight: 650, color: 'var(--gold)' }}>{w.reference}</div>}
          {w.body && (
            <div className="pre" style={{ fontSize: 16.5, lineHeight: 1.65 }}>
              {w.body}
            </div>
          )}
          {w.author && <div className="muted">— {w.author}</div>}
        </article>
      )}
      {editing && w && <WordSheet word={w} onClose={() => setEditing(false)} onDone={() => void reload()} onDeleted={() => navigate('/palavra')} />}
    </Page>
  );
}

function WordSheet({ word, onClose, onDone, onDeleted }: { word?: Word; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const { church } = useSession();
  const [day, setDay] = useState(word?.day ?? todayYmd());
  const [title, setTitle] = useState(word?.title ?? '');
  const [reference, setReference] = useState(word?.reference ?? '');
  const [verse, setVerse] = useState(word?.verse ?? '');
  const [body, setBody] = useState(word?.body ?? '');
  const [author, setAuthor] = useState(word?.author ?? church.pastor_display);
  const [image, setImage] = useState<string | null>(word?.image_id ?? null);
  const [isPublic, setIsPublic] = useState(word ? word.visibility === 'public' : true);
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={word ? 'Editar Palavra' : 'Nova Palavra do dia'}
      onClose={onClose}
      footer={
        <>
          {word && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar esta Palavra?', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/palavra/${word.id}`, { method: 'DELETE' });
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
                const payload = { day, title, reference, verse, body, author, image_id: image, visibility: isPublic ? 'public' : 'members' };
                if (word) await api(`/palavra/${word.id}`, { method: 'PUT', body: payload });
                else await api('/palavra', { method: 'POST', body: payload });
                onDone();
                onClose();
              }, 'Palavra salva.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Dia" type="date" value={day} onChange={setDay} hint="Pode agendar para os próximos dias. A notificação sai no dia, pela manhã." />
        <TextField label="Título" value={title} onChange={setTitle} maxLength={120} placeholder="Ex.: Deus restaura" />
        <TextField label="Referência bíblica" value={reference} onChange={setReference} maxLength={80} placeholder="Ex.: Joel 2.25" />
        <TextField label="Versículo (texto)" value={verse} onChange={setVerse} multiline rows={3} maxLength={1200} />
        <TextField label="Mensagem" value={body} onChange={setBody} multiline rows={6} maxLength={8000} />
        <TextField label="Autor" value={author} onChange={setAuthor} maxLength={80} />
        <CoverPicker value={image} onChange={setImage} access={isPublic ? 'public' : 'members'} />
        <Toggle label="Pública" hint={isPublic ? 'Visitantes também leem.' : 'Só membros leem.'} checked={isPublic} onChange={setIsPublic} />
      </div>
    </Sheet>
  );
}
