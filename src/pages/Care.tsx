/** Pedidos de oração e testemunhos. */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, EyeOff, HandHeart, Heart, MessageSquareHeart, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Prayer, Testimony } from '../lib/types';
import { ago } from '../lib/format';
import { DriveVideo } from '../components/cards';
import {
  Avatar,
  Button,
  Chips,
  confirmDialog,
  Empty,
  ErrorBox,
  LoadingList,
  LoginPrompt,
  MediaImg,
  Page,
  Seg,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
  CoverPicker,
} from '../components/ui';

// ======================= ORAÇÃO =======================

export function PrayerPage() {
  const { user, isMember, isLeader } = useSession();
  const [params, setParams] = useSearchParams();
  const filtro = params.get('filtro') ?? (isMember ? 'mural' : 'meus');
  const { data, error, loading, reload, mutate } = useApi<{ prayers: Prayer[]; next: number | null }>(user ? `/oracao?filtro=${filtro}` : null);
  const [asking, setAsking] = useState(false);
  const [answering, setAnswering] = useState<Prayer | null>(null);

  if (!user)
    return (
      <Page title="Pedidos de oração">
        <div className="stack">
          <LoginPrompt text="Entre com sua conta Google para pedir oração e orar pelos irmãos. Se preferir, use o cartão do visitante." />
        </div>
      </Page>
    );

  const prayed = async (p: Prayer) => {
    if (p.prayed) return;
    mutate((d) => ({ ...d, prayers: d.prayers.map((x) => (x.id === p.id ? { ...x, prayed: 1, pray_count: x.pray_count + 1 } : x)) }));
    try {
      await api(`/oracao/${p.id}/orei`, { method: 'POST', body: {} });
    } catch (e) {
      toastError(e);
    }
  };

  const options = [
    ...(isMember ? [{ value: 'mural', label: 'Mural da igreja' }] : []),
    { value: 'meus', label: 'Meus pedidos' },
    ...(isLeader ? [{ value: 'lideranca', label: 'Para a liderança' }] : []),
  ];

  return (
    <Page
      title="Pedidos de oração"
      actions={
        <Button size="sm" icon={<Plus />} onClick={() => setAsking(true)}>
          Pedir
        </Button>
      }
    >
      <div className="stack">
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          “Orai uns pelos outros” (Tg 5.16). Toque em <strong>Orei</strong> quando orar por um pedido.
        </p>
        {options.length > 1 && <Chips value={filtro} onChange={(v) => setParams({ filtro: v }, { replace: true })} options={options} />}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.prayers.length ? (
          data.prayers.map((p) => (
            <article key={p.id} className="card card-pad stack" style={{ gap: 10, opacity: p.hidden ? 0.55 : 1 }}>
              <div className="row">
                {p.author_name ? <Avatar name={p.author_name} picture={p.author_picture} size={34} /> : <span className="icon-tile gold" style={{ width: 34, height: 34, borderRadius: 99 }}><HandHeart size={17} /></span>}
                <div className="grow">
                  <div style={{ fontWeight: 620, fontSize: 14.5 }}>
                    {p.author_name ?? 'Pedido anônimo'}
                    {p.anonymous && p.author_name ? <span className="muted small"> (anônimo para a igreja)</span> : null}
                  </div>
                  <div className="tiny muted">
                    {ago(p.created_at)}
                    {p.visibility === 'lideranca' ? ' · só a liderança vê' : ''}
                  </div>
                </div>
                {p.answered ? (
                  <span className="badge ok">
                    <Check size={12} /> Respondido
                  </span>
                ) : null}
              </div>
              <p className="pre">{p.body}</p>
              {p.answered && p.answered_note ? (
                <div className="alert ok small">
                  <Sparkles />
                  <span className="pre">{p.answered_note}</span>
                </div>
              ) : null}
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {p.visibility === 'igreja' && isMember && (
                  <Button size="sm" variant={p.prayed ? 'gold' : 'secondary'} icon={<HandHeart />} onClick={() => void prayed(p)}>
                    {p.prayed ? 'Orei' : 'Orei por isso'} {p.pray_count ? `· ${p.pray_count}` : ''}
                  </Button>
                )}
                {p.mine && !p.answered && (
                  <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={() => setAnswering(p)}>
                    Deus respondeu!
                  </Button>
                )}
                <span className="grow" />
                {isLeader && p.visibility === 'igreja' && !p.mine && (
                  <button
                    className="icon-btn"
                    aria-label={p.hidden ? 'Mostrar no mural' : 'Ocultar do mural'}
                    title={p.hidden ? 'Mostrar no mural' : 'Ocultar do mural'}
                    onClick={async () => {
                      try {
                        await api(`/oracao/${p.id}`, { method: 'PATCH', body: { hidden: !p.hidden } });
                        void reload();
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    <EyeOff size={19} />
                  </button>
                )}
                {(p.mine || isLeader) && (
                  <button
                    className="icon-btn"
                    aria-label="Apagar pedido"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Apagar este pedido?', confirmLabel: 'Apagar', danger: true }))) return;
                      try {
                        await api(`/oracao/${p.id}`, { method: 'DELETE' });
                        mutate((d) => ({ ...d, prayers: d.prayers.filter((x) => x.id !== p.id) }));
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    <Trash2 size={19} />
                  </button>
                )}
              </div>
            </article>
          ))
        ) : (
          <Empty
            icon={<HandHeart />}
            title={filtro === 'meus' ? 'Você ainda não fez pedidos' : 'Nenhum pedido por aqui'}
            text="A igreja está pronta para orar com você."
            action={
              <Button icon={<Plus />} onClick={() => setAsking(true)}>
                Fazer um pedido
              </Button>
            }
          />
        )}
      </div>
      {asking && (
        <AskSheet
          onClose={() => setAsking(false)}
          onDone={(vis) => {
            setParams({ filtro: vis === 'igreja' && isMember ? 'mural' : 'meus' }, { replace: true });
            void reload();
          }}
        />
      )}
      {answering && <AnsweredSheet prayer={answering} onClose={() => setAnswering(null)} onDone={() => void reload()} />}
    </Page>
  );
}

function AskSheet({ onClose, onDone }: { onClose: () => void; onDone: (vis: string) => void }) {
  const { isMember } = useSession();
  const [body, setBody] = useState('');
  const [vis, setVis] = useState<'igreja' | 'lideranca'>(isMember ? 'igreja' : 'lideranca');
  const [anon, setAnon] = useState(false);
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title="Pedido de oração"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          icon={<HandHeart />}
          onClick={() =>
            void run(async () => {
              await api('/oracao', { method: 'POST', body: { body, visibility: vis, anonymous: anon } });
              onDone(vis);
              onClose();
            }, 'Pedido enviado. Estamos orando com você!')
          }
        >
          Enviar pedido
        </Button>
      }
    >
      <div className="stack">
        <TextField label="Pelo que podemos orar?" value={body} onChange={setBody} multiline rows={5} maxLength={1500} />
        {isMember ? (
          <div className="field">
            <span className="field-label">Quem pode ver</span>
            <Seg
              value={vis}
              onChange={setVis}
              options={[
                { value: 'igreja', label: 'Toda a igreja' },
                { value: 'lideranca', label: 'Só a liderança' },
              ]}
            />
          </div>
        ) : (
          <div className="alert small">
            <HandHeart />
            <span>Seu pedido vai direto para a liderança, que vai orar por você.</span>
          </div>
        )}
        {vis === 'igreja' && <Toggle label="Não mostrar meu nome" hint="A liderança ainda sabe quem pediu, para poder cuidar de você." checked={anon} onChange={setAnon} />}
      </div>
    </Sheet>
  );
}

function AnsweredSheet({ prayer, onClose, onDone }: { prayer: Prayer; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title="Deus respondeu!"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          icon={<Check />}
          onClick={() =>
            void run(async () => {
              await api(`/oracao/${prayer.id}/respondida`, { method: 'POST', body: { note } });
              onDone();
              onClose();
            }, 'Glória a Deus!')
          }
        >
          Marcar como respondido
        </Button>
      }
    >
      <div className="stack">
        <p className="small muted">Conte como foi (opcional). Se quiser, compartilhe também como testemunho.</p>
        <TextField label="Como Deus respondeu" value={note} onChange={setNote} multiline rows={4} maxLength={1000} />
      </div>
    </Sheet>
  );
}

// ======================= TESTEMUNHOS =======================

export function TestimoniesPage() {
  // Os testemunhos publicados são abertos a todos; contar um continua sendo coisa de membro.
  return <TestimoniesInner />;
}

function TestimoniesInner() {
  const { user, isMember, isLeader } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'aprovado';
  const { data, error, loading, reload, mutate } = useApi<{ testimonies: Testimony[] }>(`/testemunhos?status=${status}`);
  const [writing, setWriting] = useState(false);

  useEffect(() => {
    if ((!isLeader && status === 'pendente') || (!user && status === 'meus')) setParams({}, { replace: true });
  }, [isLeader, user, status, setParams]);

  const amen = async (t: Testimony) => {
    if (t.amen) return;
    mutate((d) => ({ ...d, testimonies: d.testimonies.map((x) => (x.id === t.id ? { ...x, amen: 1, amen_count: x.amen_count + 1 } : x)) }));
    await api(`/testemunhos/${t.id}/amem`, { method: 'POST', body: {} }).catch(toastError);
  };

  const review = async (t: Testimony, st: 'aprovado' | 'recusado') => {
    try {
      await api(`/testemunhos/${t.id}/revisar`, { method: 'POST', body: { status: st } });
      toast(st === 'aprovado' ? 'Testemunho publicado.' : 'Testemunho recusado.', 'ok');
      void reload();
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <Page
      title="Testemunhos"
      actions={
        isMember && (
          <Button size="sm" icon={<Plus />} onClick={() => setWriting(true)}>
            Contar
          </Button>
        )
      }
    >
      <div className="stack">
        <Chips
          value={status}
          onChange={(v) => setParams({ status: v }, { replace: true })}
          options={[
            { value: 'aprovado', label: 'Testemunhos' },
            ...(user ? [{ value: 'meus', label: 'Os meus' }] : []),
            ...(isLeader ? [{ value: 'pendente', label: 'Para revisar' }] : []),
          ]}
        />
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.testimonies.length ? (
          data.testimonies.map((t) => (
            <article key={t.id} className="card" style={{ overflow: 'hidden' }}>
              {/* Com vídeo, a foto vira a capa dele: uma mídia só no testemunho. */}
              {t.video_drive_id ? (
                <DriveVideo id={t.video_drive_id} title={t.title} posterId={t.image_id} />
              ) : (
                t.image_id && <MediaImg id={t.image_id} className="cover" style={{ borderRadius: 0 }} />
              )}
              <div className="card-pad stack" style={{ gap: 10 }}>
                <div className="row">
                  <Avatar name={t.author_name ?? '?'} picture={t.author_picture} size={34} />
                  <div className="grow">
                    <div style={{ fontWeight: 620 }}>{t.author_name ?? 'Membro'}</div>
                    <div className="tiny muted">{ago(t.created_at)}</div>
                  </div>
                  {t.status !== 'aprovado' && <span className={`badge ${t.status === 'pendente' ? 'warn' : 'danger'}`}>{t.status === 'pendente' ? 'Em análise' : 'Não publicado'}</span>}
                </div>
                {t.title && <h3 style={{ fontFamily: 'var(--serif)', fontWeight: 560, fontSize: 19 }}>{t.title}</h3>}
                <p className="pre">{t.body}</p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {t.status === 'aprovado' && isMember && (
                    <Button size="sm" variant={t.amen ? 'gold' : 'secondary'} icon={<Heart />} onClick={() => void amen(t)}>
                      Amém {t.amen_count ? `· ${t.amen_count}` : ''}
                    </Button>
                  )}
                  {status === 'pendente' && (
                    <>
                      <Button size="sm" variant="ok" icon={<Check />} onClick={() => void review(t, 'aprovado')}>
                        Publicar
                      </Button>
                      <Button size="sm" variant="danger" icon={<X />} onClick={() => void review(t, 'recusado')}>
                        Recusar
                      </Button>
                    </>
                  )}
                  <span className="grow" />
                  {(status === 'meus' || isLeader) && (
                    <button
                      className="icon-btn"
                      aria-label="Apagar"
                      onClick={async () => {
                        if (!(await confirmDialog({ title: 'Apagar este testemunho?', confirmLabel: 'Apagar', danger: true }))) return;
                        try {
                          await api(`/testemunhos/${t.id}`, { method: 'DELETE' });
                          void reload();
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      <Trash2 size={19} />
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))
        ) : (
          <Empty
            icon={<MessageSquareHeart />}
            title={status === 'pendente' ? 'Nada para revisar' : 'Nenhum testemunho ainda'}
            text={status === 'pendente' ? undefined : 'Conte o que Deus fez na sua vida e edifique a igreja.'}
          />
        )}
      </div>
      {writing && <TestimonySheet onClose={() => setWriting(false)} onDone={() => setParams({ status: 'meus' }, { replace: true })} />}
    </Page>
  );
}

function TestimonySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [video, setVideo] = useState('');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title="Contar um testemunho"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api('/testemunhos', { method: 'POST', body: { title, body, image_id: image, video_url: video.trim() || null } });
              onDone();
              onClose();
            }, 'Enviado! A liderança vai publicar em breve.')
          }
        >
          Enviar para publicação
        </Button>
      }
    >
      <div className="stack">
        <TextField label="Título (opcional)" value={title} onChange={setTitle} maxLength={120} placeholder="Ex.: Deus curou minha mãe" />
        <TextField label="Seu testemunho" value={body} onChange={setBody} multiline rows={7} maxLength={5000} />
        <CoverPicker value={image} onChange={setImage} access="members" label="Foto (opcional)" />
        <TextField
          label="Vídeo do Google Drive (opcional)"
          value={video}
          onChange={setVideo}
          inputMode="url"
          placeholder="https://drive.google.com/file/d/…"
          hint={'No Drive: abra o vídeo → Compartilhar → em "Acesso geral" escolha "Qualquer pessoa com o link" → Copiar link.'}
        />
        <p className="tiny muted">A liderança lê antes de publicar para a igreja.</p>
      </div>
    </Sheet>
  );
}
