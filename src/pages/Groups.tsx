/** Campanhas (ex.: 21 dias de oração) e grupos: Células, Casa de Paz, Rede Jovem, Missões. */
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Globe2, Home, AtSign, MapPin, MessageCircle, Pencil, Plus, Sparkles, Trash2, User, Users } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Campaign, Ministry } from '../lib/types';
import { addDaysYmd, longDate, phoneLink, shortDate, todayYmd, ymdParts } from '../lib/format';
import { helpDrain } from '../lib/push';
import {
  Avatar,
  Button,
  confirmDialog,
  CoverPicker,
  Empty,
  ErrorBox,
  LoadingList,
  MediaImg,
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

// ======================= CAMPANHAS =======================

export function Campaigns() {
  const { isLeader } = useSession();
  const { data, error, loading, reload } = useApi<{ campaigns: Campaign[]; today: string }>('/campanhas');
  const [creating, setCreating] = useState(false);
  const today = data?.today ?? todayYmd();
  const active = data?.campaigns.filter((c) => c.start_date <= today && c.end_date >= today) ?? [];
  const soon = data?.campaigns.filter((c) => c.start_date > today) ?? [];
  const past = data?.campaigns.filter((c) => c.end_date < today) ?? [];
  const Card = ({ c }: { c: Campaign }) => (
    <Link to={`/campanhas/${c.id}`} className="card card-link" style={{ overflow: 'hidden' }}>
      {c.cover_id && <MediaImg id={c.cover_id} className="cover" style={{ borderRadius: 0 }} />}
      <div className="card-pad">
        <div className="row-between">
          <h3 style={{ fontSize: 17 }}>{c.title}</h3>
          {c.joined ? <span className="badge ok">Participando</span> : null}
        </div>
        <div className="small muted">
          {shortDate(c.start_date)} a {shortDate(c.end_date)} · {c.days_total} dias · {c.members} participante{c.members === 1 ? '' : 's'}
        </div>
        {c.joined ? (
          <div className="progress gold mt-2">
            <div style={{ width: `${Math.min(100, (c.my_checkins / c.days_total) * 100)}%` }} />
          </div>
        ) : null}
      </div>
    </Link>
  );
  return (
    <Page
      title="Campanhas"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            Campanha
          </Button>
        ) : undefined
      }
    >
      <div className="stack-lg">
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? <LoadingList /> : null}
        {data && !data.campaigns.length && (
          <Empty icon={<Sparkles />} title="Nenhuma campanha no momento" text="Campanhas de oração, jejum e propósito aparecem aqui, com um diário para marcar cada dia." />
        )}
        {active.length > 0 && (
          <Section title="Acontecendo agora">
            <div className="stack">
              {active.map((c) => (
                <Card key={c.id} c={c} />
              ))}
            </div>
          </Section>
        )}
        {soon.length > 0 && (
          <Section title="Em breve">
            <div className="stack">
              {soon.map((c) => (
                <Card key={c.id} c={c} />
              ))}
            </div>
          </Section>
        )}
        {past.length > 0 && (
          <Section title="Encerradas">
            <div className="stack">
              {past.map((c) => (
                <Card key={c.id} c={c} />
              ))}
            </div>
          </Section>
        )}
      </div>
      {creating && <CampaignSheet onClose={() => setCreating(false)} onDone={() => void reload()} />}
    </Page>
  );
}

export function CampaignDetail() {
  const { id } = useParams();
  const { isMember, isLeader } = useSession();
  const navigate = useNavigate();
  const { data, error, reload } = useApi<{ campaign: Campaign; my_days: string[]; participants: { name: string; checkins: number }[]; today: string }>(`/campanhas/${id}`);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useAction();
  const c = data?.campaign;
  const today = data?.today ?? todayYmd();
  const days = c ? Array.from({ length: c.days_total }, (_, i) => addDaysYmd(c.start_date, i)) : [];
  const mine = new Set(data?.my_days ?? []);
  const running = c ? c.start_date <= today && c.end_date >= today : false;

  const toggle = (day: string) =>
    run(async () => {
      await api(`/campanhas/${id}/checkin`, { method: 'POST', body: { day } });
      await reload();
    });

  return (
    <Page
      title="Campanha"
      back="/campanhas"
      actions={
        isLeader && c ? (
          <button className="icon-btn" aria-label="Editar" onClick={() => setEditing(true)}>
            <Pencil />
          </button>
        ) : undefined
      }
    >
      {error && <ErrorBox error={error} retry={reload} />}
      {c && (
        <div className="stack-lg">
          <div className="stack">
            {c.cover_id && <MediaImg id={c.cover_id} className="cover" />}
            <h1 style={{ fontSize: 26 }}>{c.title}</h1>
            <div className="small muted">
              {longDate(c.start_date)} até {longDate(c.end_date)} · {c.members} participante{c.members === 1 ? '' : 's'}
            </div>
            {c.daily_goal && (
              <div className="alert" style={{ background: 'var(--gold-soft)' }}>
                <Sparkles style={{ color: 'var(--gold)' }} />
                <div>
                  <div style={{ fontWeight: 650 }}>Propósito de cada dia</div>
                  <div className="pre">{c.daily_goal}</div>
                </div>
              </div>
            )}
            {c.description && <p className="pre" style={{ color: 'var(--ink-2)' }}>{c.description}</p>}
          </div>

          {isMember && (
            <section className="card card-pad stack">
              {c.joined ? (
                <>
                  <div className="row-between">
                    <div style={{ fontWeight: 650 }}>Meu diário</div>
                    <span className="small muted">
                      {mine.size} de {c.days_total} dias
                    </span>
                  </div>
                  <div className="progress gold">
                    <div style={{ width: `${(mine.size / c.days_total) * 100}%` }} />
                  </div>
                  <div className="days-grid">
                    {days.map((d, i) => {
                      const future = d > today;
                      const editable = !future && d >= addDaysYmd(today, -2);
                      return (
                        <button
                          key={d}
                          className={`day-dot ${mine.has(d) ? 'done' : ''} ${d === today ? 'today' : ''} ${future ? 'future' : ''}`}
                          disabled={!editable || busy}
                          onClick={() => void toggle(d)}
                          title={`${longDate(d)}${mine.has(d) ? ' — cumprido' : ''}`}
                          aria-label={`Dia ${i + 1}${mine.has(d) ? ', cumprido' : ''}`}
                          style={{ cursor: editable ? 'pointer' : 'default' }}
                        >
                          {mine.has(d) ? <Check size={15} /> : ymdParts(d).day}
                        </button>
                      );
                    })}
                  </div>
                  {running && (
                    <Button variant={mine.has(today) ? 'ok' : 'gold'} icon={<Check />} loading={busy} onClick={() => void toggle(today)}>
                      {mine.has(today) ? 'Hoje cumprido!' : 'Marcar o dia de hoje'}
                    </Button>
                  )}
                  <button
                    className="link-btn small"
                    style={{ alignSelf: 'center', color: 'var(--ink-3)' }}
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Sair da campanha?', text: 'Seu diário será apagado.', confirmLabel: 'Sair', danger: true }))) return;
                      await run(async () => {
                        await api(`/campanhas/${id}/sair`, { method: 'POST', body: {} });
                        await reload();
                      });
                    }}
                  >
                    Sair da campanha
                  </button>
                </>
              ) : c.end_date >= today ? (
                <Button
                  variant="gold"
                  icon={<Sparkles />}
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/campanhas/${id}/participar`, { method: 'POST', body: {} });
                      await reload();
                    }, 'Você está participando!')
                  }
                >
                  Quero participar
                </Button>
              ) : (
                <p className="small muted">Esta campanha já terminou.</p>
              )}
            </section>
          )}

          {isLeader && data!.participants.length > 0 && (
            <Section title="Participantes">
              <div className="card">
                <div className="list">
                  {data!.participants.map((p, i) => (
                    <div key={i} className="list-item" style={{ cursor: 'default' }}>
                      <Avatar name={p.name} size={32} />
                      <div className="grow" style={{ fontWeight: 600 }}>
                        {p.name}
                      </div>
                      <span className="small muted">
                        {p.checkins}/{c.days_total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}
        </div>
      )}
      {editing && c && <CampaignSheet campaign={c} onClose={() => setEditing(false)} onDone={() => void reload()} onDeleted={() => navigate('/campanhas')} />}
    </Page>
  );
}

function CampaignSheet({ campaign, onClose, onDone, onDeleted }: { campaign?: Campaign; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const [title, setTitle] = useState(campaign?.title ?? '');
  const [desc, setDesc] = useState(campaign?.description ?? '');
  const [goal, setGoal] = useState(campaign?.daily_goal ?? '');
  const [start, setStart] = useState(campaign?.start_date ?? todayYmd());
  const [end, setEnd] = useState(campaign?.end_date ?? addDaysYmd(todayYmd(), 20));
  const [cover, setCover] = useState<string | null>(campaign?.cover_id ?? null);
  const [isPublic, setIsPublic] = useState(campaign ? campaign.visibility === 'public' : false);
  const [notify, setNotify] = useState(true);
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={campaign ? 'Editar campanha' : 'Nova campanha'}
      onClose={onClose}
      footer={
        <>
          {campaign && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar a campanha?', text: 'Os diários dos participantes também serão apagados.', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/campanhas/${campaign.id}`, { method: 'DELETE' });
                  toast('Campanha apagada.', 'ok');
                  onClose();
                  onDeleted?.();
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
                const body = { title, description: desc, daily_goal: goal, start_date: start, end_date: end, cover_id: cover, visibility: isPublic ? 'public' : 'members', notify: !campaign && notify };
                if (campaign) await api(`/campanhas/${campaign.id}`, { method: 'PUT', body });
                else await api('/campanhas', { method: 'POST', body });
                if (!campaign && notify) void helpDrain();
                onDone();
                onClose();
              }, 'Campanha salva.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Nome" value={title} onChange={setTitle} maxLength={120} placeholder="Ex.: 21 dias de oração" />
        <div className="form-grid">
          <TextField label="Começa" type="date" value={start} onChange={setStart} />
          <TextField label="Termina" type="date" value={end} onChange={setEnd} />
        </div>
        <TextField label="Propósito de cada dia" value={goal} onChange={setGoal} multiline rows={2} maxLength={300} placeholder="Ex.: Oração às 6h e leitura de um capítulo de Salmos" />
        <TextField label="Descrição" value={desc} onChange={setDesc} multiline rows={4} maxLength={4000} />
        <CoverPicker value={cover} onChange={setCover} access={isPublic ? 'public' : 'members'} />
        <Toggle label="Pública" hint={isPublic ? 'Visitantes também veem.' : 'Só membros veem.'} checked={isPublic} onChange={setIsPublic} />
        {!campaign && <Toggle label="Avisar por notificação" checked={notify} onChange={setNotify} />}
      </div>
    </Sheet>
  );
}

// ======================= GRUPOS =======================

const TYPE_LABEL: Record<Ministry['type'], string> = {
  celula: 'Célula',
  casa_de_paz: 'Casa de Paz',
  ministerio: 'Ministério',
  missoes: 'Missões',
};
const TYPE_ICON: Record<Ministry['type'], React.JSX.Element> = {
  celula: <Users />,
  casa_de_paz: <Home />,
  ministerio: <Sparkles />,
  missoes: <Globe2 />,
};

export function Ministries() {
  const { isMember, isLeader, user } = useSession();
  const [all, setAll] = useState(false);
  const { data, error, loading, reload, mutate } = useApi<{ ministries: Ministry[] }>(`/ministerios${all ? '?todos=1' : ''}`);
  const [edit, setEdit] = useState<Ministry | 'new' | null>(null);
  const [joining, setJoining] = useState<Ministry | null>(null);
  return (
    <Page
      title="Células e grupos"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setEdit('new')}>
            Grupo
          </Button>
        ) : undefined
      }
    >
      <div className="stack">
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Ninguém caminha sozinho. Encontre um grupo perto de você e participe durante a semana.
        </p>
        {isLeader && (
          <div className="row-between">
            <Toggle label="Mostrar inativos" checked={all} onChange={setAll} />
            <Link to="/admin/pedidos" className="small">
              Pedidos para participar
            </Link>
          </div>
        )}
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.ministries.length ? (
          data.ministries.map((m) => (
            <article key={m.id} className="card" style={{ overflow: 'hidden', opacity: m.active ? 1 : 0.6 }}>
              {m.cover_id && <MediaImg id={m.cover_id} className="cover" style={{ borderRadius: 0 }} />}
              <div className="card-pad stack" style={{ gap: 10 }}>
                <div className="row">
                  <div className="icon-tile">{TYPE_ICON[m.type]}</div>
                  <div className="grow">
                    <h3 style={{ fontSize: 17 }}>{m.name}</h3>
                    <div className="small muted">
                      {TYPE_LABEL[m.type]}
                      {m.schedule_note ? ` · ${m.schedule_note}` : ''}
                    </div>
                  </div>
                  {isLeader && m.new_requests > 0 && <span className="count-pill">{m.new_requests}</span>}
                  {isLeader && (
                    <button className="icon-btn" aria-label="Editar" onClick={() => setEdit(m)}>
                      <Pencil size={19} />
                    </button>
                  )}
                </div>
                {m.description && <p className="pre small" style={{ color: 'var(--ink-2)' }}>{m.description}</p>}
                <div className="stack small" style={{ gap: 4, color: 'var(--ink-2)' }}>
                  {m.leader_name && (
                    <div className="row" style={{ gap: 6 }}>
                      <User size={15} /> Líder: {m.leader_name}
                    </div>
                  )}
                  {(m.neighborhood || m.address) && (
                    <div className="row" style={{ gap: 6 }}>
                      <MapPin size={15} /> {[m.neighborhood, m.address].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  {isMember ? (
                    m.requested ? (
                      <span className="badge ok">
                        <Check size={12} /> Pedido enviado
                      </span>
                    ) : (
                      <Button size="sm" onClick={() => setJoining(m)}>
                        Quero participar
                      </Button>
                    )
                  ) : !user ? (
                    <Link className="btn btn-soft btn-sm" to="/entrar?voltar=/grupos">
                      Entre para participar
                    </Link>
                  ) : null}
                  {isMember && m.contact_phone && (
                    <a className="btn btn-secondary btn-sm" href={phoneLink(m.contact_phone, `Olá! Vi o grupo ${m.name} no app da IRN e quero participar.`)} target="_blank" rel="noopener noreferrer">
                      <MessageCircle /> WhatsApp
                    </a>
                  )}
                  {m.instagram && (
                    <a className="btn btn-ghost btn-sm" href={`https://instagram.com/${m.instagram}`} target="_blank" rel="noopener noreferrer">
                      <AtSign /> @{m.instagram}
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))
        ) : (
          <Empty icon={<Users />} title="Nenhum grupo cadastrado" />
        )}
      </div>
      {edit && <MinistrySheet ministry={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} onDone={() => void reload()} />}
      {joining && (
        <JoinSheet
          m={joining}
          onClose={() => setJoining(null)}
          onDone={() => mutate((d) => ({ ...d, ministries: d.ministries.map((x) => (x.id === joining.id ? { ...x, requested: 1 } : x)) }))}
        />
      )}
    </Page>
  );
}

function JoinSheet({ m, onClose, onDone }: { m: Ministry; onClose: () => void; onDone: () => void }) {
  const [msg, setMsg] = useState('');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      small
      title={`Participar: ${m.name}`}
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api(`/ministerios/${m.id}/participar`, { method: 'POST', body: { message: msg } });
              onDone();
              onClose();
            }, 'Pedido enviado! A liderança vai falar com você.')
          }
        >
          Enviar pedido
        </Button>
      }
    >
      <div className="stack">
        <p className="small muted">A liderança recebe seu nome e telefone do cadastro para entrar em contato.</p>
        <TextField label="Mensagem (opcional)" value={msg} onChange={setMsg} multiline rows={3} maxLength={500} placeholder="Ex.: Moro na Penha e posso às quintas." />
      </div>
    </Sheet>
  );
}

function MinistrySheet({ ministry, onClose, onDone }: { ministry?: Ministry; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<Ministry['type']>(ministry?.type ?? 'celula');
  const [name, setName] = useState(ministry?.name ?? '');
  const [desc, setDesc] = useState(ministry?.description ?? '');
  const [leader, setLeader] = useState(ministry?.leader_name ?? '');
  const [when, setWhen] = useState(ministry?.schedule_note ?? '');
  const [hood, setHood] = useState(ministry?.neighborhood ?? '');
  const [address, setAddress] = useState(ministry?.address ?? '');
  const [phone, setPhone] = useState(ministry?.contact_phone ?? '');
  const [ig, setIg] = useState(ministry?.instagram ?? '');
  const [cover, setCover] = useState<string | null>(ministry?.cover_id ?? null);
  const [active, setActive] = useState(ministry ? !!ministry.active : true);
  const [sort, setSort] = useState(String(ministry?.sort ?? 50));
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      title={ministry ? 'Editar grupo' : 'Novo grupo'}
      onClose={onClose}
      footer={
        <>
          {ministry && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: `Apagar "${ministry.name}"?`, text: 'Os pedidos para participar também serão apagados. Para só esconder, desligue "Ativo".', confirmLabel: 'Apagar', danger: true }))) return;
                await run(async () => {
                  await api(`/ministerios/${ministry.id}`, { method: 'DELETE' });
                  onDone();
                  onClose();
                }, 'Grupo apagado.');
              }}
            >
              Apagar
            </Button>
          )}
          <Button
            loading={busy}
            onClick={() =>
              void run(async () => {
                const body = { type, name, description: desc, leader_name: leader, schedule_note: when, neighborhood: hood, address, contact_phone: phone, instagram: ig, cover_id: cover, active, sort: Number(sort) || 50 };
                if (ministry) await api(`/ministerios/${ministry.id}`, { method: 'PUT', body });
                else await api('/ministerios', { method: 'POST', body });
                onDone();
                onClose();
              }, 'Grupo salvo.')
            }
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <SelectField
          label="Tipo"
          value={type}
          onChange={setType}
          options={(Object.keys(TYPE_LABEL) as Ministry['type'][]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />
        <TextField label="Nome" value={name} onChange={setName} maxLength={80} placeholder="Ex.: Célula Penha" />
        <TextField label="Descrição" value={desc} onChange={setDesc} multiline rows={3} maxLength={3000} />
        <div className="form-grid collapse">
          <TextField label="Líder" value={leader} onChange={setLeader} maxLength={120} />
          <TextField label="Dia e horário" value={when} onChange={setWhen} maxLength={120} placeholder="Ex.: Quintas, 20h" />
        </div>
        <div className="form-grid collapse">
          <TextField label="Bairro" value={hood} onChange={setHood} maxLength={80} />
          <TextField label="WhatsApp do líder" value={phone} onChange={setPhone} maxLength={30} inputMode="tel" hint="Só membros veem." />
        </div>
        <TextField label="Endereço (opcional)" value={address} onChange={setAddress} maxLength={200} hint="Só membros aprovados veem o endereço." />
        <TextField label="Instagram (opcional)" value={ig} onChange={setIg} maxLength={60} placeholder="@perfil" />
        <CoverPicker value={cover} onChange={setCover} access="public" />
        <div className="form-grid">
          <TextField label="Ordem na lista" value={sort} onChange={(v) => setSort(v.replace(/\D/g, ''))} inputMode="numeric" />
          <div style={{ alignSelf: 'end', paddingBottom: 10 }}>
            <Toggle label="Ativo" checked={active} onChange={setActive} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
