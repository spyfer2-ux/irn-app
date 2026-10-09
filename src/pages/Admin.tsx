/** Área da liderança e da administração. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Cake,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  ImagePlus,
  MessageCircle,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Settings,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Church, Contribution, Me, ScheduleItem } from '../lib/types';
import { ago, bytes, MONTHS, MONTHS_SHORT, money, phoneLink, shortDate, todayYmd, WEEKDAYS } from '../lib/format';
import { helpDrain } from '../lib/push';
import { parseCents, pixPayload } from '../lib/pix';
import { prepareIcons } from '../lib/image';
import { uploadImage } from '../lib/upload';
import {
  Avatar,
  Button,
  Chips,
  confirmDialog,
  CopyButton,
  Empty,
  ErrorBox,
  LoadingList,
  mediaUrl,
  Page,
  ROLE_LABEL,
  RoleOnly,
  Section,
  SelectField,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';
import { ColumnChart, StatTile, type ChartRow } from '../components/charts';
import { Qr } from './Giving';

// ======================= PAINEL =======================

interface Summary {
  pending_users: number;
  members: number;
  active_30d: number;
  new_visitors: number;
  pending_testimonies: number;
  leadership_prayers_7d: number;
  ministry_requests: number;
  pending_contributions: number | null;
  photos: number;
  videos: number;
  push_devices: number;
  storage_bytes: number;
  storage_mode: 'r2' | 'd1';
}

export function AdminHome() {
  return (
    <RoleOnly need="leader">
      <AdminHomeInner />
    </RoleOnly>
  );
}

function AdminHomeInner() {
  const { isAdmin, features, church } = useSession();
  const { data, error, reload } = useApi<Summary>('/admin/resumo');
  const giving = useApi<{ configured: boolean }>('/dizimos');
  const todo = data
    ? [
        data.pending_users && { to: '/admin/membros?status=pendente', label: `${data.pending_users} cadastro(s) para aprovar`, icon: <Users /> },
        data.pending_testimonies && { to: '/testemunhos?status=pendente', label: `${data.pending_testimonies} testemunho(s) para revisar`, icon: <ClipboardList /> },
        data.new_visitors && { to: '/admin/visitantes', label: `${data.new_visitors} visitante(s) novo(s)`, icon: <UserPlus /> },
        data.ministry_requests && { to: '/admin/pedidos', label: `${data.ministry_requests} pedido(s) para grupos`, icon: <ClipboardList /> },
        data.leadership_prayers_7d && { to: '/oracao?filtro=lideranca', label: `${data.leadership_prayers_7d} pedido(s) de oração para a liderança (7 dias)`, icon: <ClipboardList /> },
        isAdmin && data.pending_contributions && { to: '/admin/contribuicoes?status=informado', label: `${data.pending_contributions} contribuição(ões) para conferir`, icon: <Wallet /> },
      ].filter(Boolean)
    : [];
  const setup = isAdmin
    ? [
        { ok: features.google, label: 'Login com Google', to: '/admin/config?aba=google' },
        { ok: !!giving.data?.configured, label: 'Chave PIX e conta para dízimos', to: '/admin/config?aba=dizimos' },
        { ok: !!church.logo_id, label: 'Logo oficial da igreja', to: '/admin/config?aba=igreja' },
        { ok: features.video_upload, label: 'Armazenamento R2 (vídeos pelo app)', to: '/admin/config?aba=armazenamento' },
        { ok: features.stream_ready, label: 'Transmissão pela câmera do app', to: '/admin/config?aba=transmissao' },
      ]
    : [];
  return (
    <Page title="Painel da liderança" back="/mais">
      <div className="stack-lg">
        {error && <ErrorBox error={error} retry={reload} />}
        {data && (
          <div className="stat-grid">
            <StatTile label="Membros aprovados" value={data.members} />
            <StatTile label="Usaram o app (30 dias)" value={data.active_30d} />
            <StatTile label="Aparelhos com notificação" value={data.push_devices} />
            <StatTile label="Fotos na biblioteca" value={data.photos} />
            <StatTile label="Vídeos" value={data.videos} />
            <StatTile label="Espaço usado" value={bytes(data.storage_bytes)} hint={data.storage_mode === 'r2' ? 'Armazenamento R2' : 'Banco D1 (sem R2)'} />
          </div>
        )}
        <Section title="Para fazer">
          {data && !todo.length ? (
            <div className="alert ok">
              <Check />
              <span>Tudo em dia!</span>
            </div>
          ) : (
            <div className="card">
              <div className="list">
                {(todo as { to: string; label: string; icon: React.JSX.Element }[]).map((t) => (
                  <Link key={t.to} to={t.to} className="list-item">
                    <span className="icon-tile gold" style={{ width: 36, height: 36 }}>
                      {t.icon}
                    </span>
                    <span className="grow" style={{ fontWeight: 560 }}>
                      {t.label}
                    </span>
                    <ChevronRight className="chev" size={18} />
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Section>
        {isAdmin && setup.some((s) => !s.ok) && (
          <Section title="Configuração do app">
            <div className="card">
              <div className="list">
                {setup.map((s) => (
                  <Link key={s.label} to={s.to} className="list-item">
                    <span className={`icon-tile ${s.ok ? 'ok' : 'gray'}`} style={{ width: 32, height: 32, borderRadius: 99 }}>
                      {s.ok ? <Check size={17} /> : <Settings size={17} />}
                    </span>
                    <span className="grow">{s.label}</span>
                    <span className={`badge ${s.ok ? 'ok' : 'warn'}`}>{s.ok ? 'Pronto' : 'Configurar'}</span>
                  </Link>
                ))}
              </div>
            </div>
          </Section>
        )}
        <Section title="Atalhos">
          <div className="card">
            <div className="list">
              {[
                { to: '/admin/membros', label: 'Membros e aprovações', icon: <Users /> },
                { to: '/admin/notificar', label: 'Enviar notificação', icon: <Send /> },
                { to: '/admin/aniversariantes', label: 'Aniversariantes', icon: <Cake /> },
                { to: '/admin/visitantes', label: 'Visitantes', icon: <UserPlus /> },
                { to: '/admin/relatorios', label: 'Relatórios', icon: <BarChart3 /> },
                ...(isAdmin
                  ? [
                      { to: '/admin/contribuicoes', label: 'Contribuições (tesouraria)', icon: <Wallet /> },
                      { to: '/admin/config', label: 'Configurações', icon: <Settings /> },
                      { to: '/admin/auditoria', label: 'Histórico de ações', icon: <ScrollText /> },
                    ]
                  : []),
              ].map((i) => (
                <Link key={i.to} to={i.to} className="list-item">
                  <span className="icon-tile" style={{ width: 36, height: 36 }}>
                    {i.icon}
                  </span>
                  <span className="grow" style={{ fontWeight: 560 }}>
                    {i.label}
                  </span>
                  <ChevronRight className="chev" size={18} />
                </Link>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </Page>
  );
}

// ======================= MEMBROS =======================

type AdminUser = Me & { notes: string | null; last_seen_at: number | null; approved_at: number | null };

export function AdminMembers() {
  return (
    <RoleOnly need="leader">
      <AdminMembersInner />
    </RoleOnly>
  );
}

function AdminMembersInner() {
  const { isAdmin } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'aprovado';
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams();
  if (status !== 'todos') qs.set('status', status);
  if (query) qs.set('q', query);
  const { data, error, loading, reload } = useApi<{ users: AdminUser[] }>(`/admin/membros?${qs}`);
  const pending = useApi<{ users: AdminUser[] }>('/admin/membros?status=pendente');
  const [open, setOpen] = useState<AdminUser | null>(null);
  const { run } = useAction();

  const quick = (u: AdminUser, st: 'aprovado' | 'bloqueado') =>
    run(async () => {
      await api(`/admin/membros/${u.id}`, { method: 'PATCH', body: { status: st } });
      void reload();
      void pending.reload();
    }, st === 'aprovado' ? `${u.name.split(' ')[0]} foi aprovado(a).` : 'Bloqueado.');

  return (
    <Page
      title="Membros"
      back="/admin"
      actions={
        isAdmin ? (
          <a className="icon-btn" href="/api/admin/membros.csv" aria-label="Baixar planilha de membros" title="Baixar planilha (CSV)">
            <Download />
          </a>
        ) : undefined
      }
    >
      <div className="stack">
        <Chips
          value={status}
          onChange={(v) => setParams({ status: v }, { replace: true })}
          options={[
            { value: 'pendente', label: `Aguardando${pending.data?.users.length ? ` (${pending.data.users.length})` : ''}` },
            { value: 'aprovado', label: 'Aprovados' },
            { value: 'bloqueado', label: 'Bloqueados' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        <div className="row" style={{ position: 'relative' }}>
          <Search size={18} style={{ position: 'absolute', left: 14, color: 'var(--ink-3)' }} />
          <input className="input" style={{ paddingLeft: 40 }} placeholder="Buscar por nome, e-mail, telefone ou bairro" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        {loading && !data ? (
          <LoadingList />
        ) : data?.users.length ? (
          <div className="card">
            <div className="list">
              {data.users.map((u) => (
                <div key={u.id} className="list-item" style={{ cursor: 'default' }}>
                  <button
                    className="row grow"
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', minWidth: 0, gap: 12 }}
                    onClick={() => setOpen(u)}
                    aria-label={`Abrir cadastro de ${u.name}`}
                  >
                    <Avatar name={u.name} picture={u.picture} size={40} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 620 }} className="ellipsis">
                        {u.name}
                      </div>
                      <div className="small muted ellipsis">{u.email}</div>
                      <div className="wrap-row mt-1">
                        {u.role !== 'membro' && <span className="badge blue">{ROLE_LABEL[u.role]}</span>}
                        {u.status === 'pendente' && <span className="badge warn">Cadastrou {ago(u.created_at)}</span>}
                        {u.status === 'bloqueado' && <span className="badge danger">Bloqueado</span>}
                      </div>
                    </div>
                  </button>
                  {u.status === 'pendente' && isAdmin && (
                    <Button size="sm" variant="ok" icon={<Check />} onClick={() => void quick(u, 'aprovado')}>
                      Aprovar
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <Empty icon={<Users />} title={status === 'pendente' ? 'Ninguém aguardando aprovação' : 'Ninguém encontrado'} />
        )}
      </div>
      {open && (
        <MemberSheet
          user={open}
          onClose={() => setOpen(null)}
          onDone={() => {
            void reload();
            void pending.reload();
          }}
        />
      )}
    </Page>
  );
}

function MemberSheet({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const { isAdmin, user: me } = useSession();
  const [status, setStatus] = useState(user.status);
  const [role, setRole] = useState(user.role);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [birthday, setBirthday] = useState(user.birthday ?? '');
  const [hood, setHood] = useState(user.neighborhood ?? '');
  const [since, setSince] = useState(user.member_since ?? '');
  const [notes, setNotes] = useState(user.notes ?? '');
  const { busy, run } = useAction();
  const save = () =>
    run(async () => {
      await api(`/admin/membros/${user.id}`, {
        method: 'PATCH',
        body: { status, role, name, phone, birthday: birthday || null, neighborhood: hood, member_since: since, notes },
      });
      onDone();
      onClose();
    }, 'Cadastro salvo.');
  return (
    <Sheet
      open
      title={user.name}
      onClose={onClose}
      footer={
        isAdmin ? (
          <>
            {user.id !== me?.id && user.role !== 'admin' && (
              <Button
                variant="danger"
                icon={<Trash2 />}
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Excluir ${user.name}?`, text: 'Apaga o cadastro e o que é pessoal (pedidos, testemunhos, confirmações). Para só impedir o acesso, use "Bloqueado".', confirmLabel: 'Excluir', danger: true }))) return;
                  await run(async () => {
                    await api(`/admin/membros/${user.id}`, { method: 'DELETE' });
                    onDone();
                    onClose();
                  }, 'Cadastro excluído.');
                }}
              >
                Excluir
              </Button>
            )}
            <Button loading={busy} onClick={() => void save()}>
              Salvar
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="row">
          <Avatar name={user.name} picture={user.picture} size={52} />
          <div className="grow small">
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {user.email}
            </div>
            <div className="muted">
              Cadastro {ago(user.created_at)}
              {user.last_seen_at ? ` · visto ${ago(user.last_seen_at)}` : ''}
            </div>
          </div>
        </div>
        {user.phone && (
          <a className="btn btn-secondary btn-sm" href={phoneLink(user.phone, `Graça e paz, ${user.name.split(' ')[0]}!`)} target="_blank" rel="noopener noreferrer">
            <MessageCircle /> WhatsApp {user.phone}
          </a>
        )}
        {user.intro && (
          <div className="alert small">
            <Users />
            <span className="pre">{user.intro}</span>
          </div>
        )}
        {isAdmin ? (
          <>
            <div className="form-grid">
              <SelectField
                label="Situação"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'pendente', label: 'Aguardando' },
                  { value: 'aprovado', label: 'Aprovado' },
                  { value: 'bloqueado', label: 'Bloqueado' },
                ]}
              />
              <SelectField
                label="Papel"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'membro', label: 'Membro' },
                  { value: 'midia', label: 'Equipe de mídia' },
                  { value: 'lider', label: 'Liderança' },
                  { value: 'admin', label: 'Administrador' },
                ]}
              />
            </div>
            <p className="tiny muted">
              Mídia: envia vídeos e faz lives. Liderança: também publica avisos, eventos, Palavra e modera. Administrador: tudo, inclusive aprovar
              pessoas, dízimos e configurações.
            </p>
            <TextField label="Nome" value={name} onChange={setName} maxLength={120} />
            <div className="form-grid collapse">
              <TextField label="Telefone" value={phone} onChange={setPhone} maxLength={30} inputMode="tel" />
              <TextField label="Aniversário" type="date" value={birthday} onChange={setBirthday} />
            </div>
            <div className="form-grid collapse">
              <TextField label="Bairro" value={hood} onChange={setHood} maxLength={80} />
              <TextField label="Membro desde" value={since} onChange={setSince} maxLength={20} />
            </div>
            <TextField label="Observações da liderança" value={notes} onChange={setNotes} multiline rows={3} maxLength={2000} hint="Só a liderança vê." />
          </>
        ) : (
          <dl className="kv small" style={{ gridTemplateColumns: 'auto 1fr' }}>
            <dt>Papel</dt>
            <dd>{ROLE_LABEL[user.role]}</dd>
            <dt>Telefone</dt>
            <dd>{user.phone || '—'}</dd>
            <dt>Aniversário</dt>
            <dd>{user.birthday ? shortDate(user.birthday).slice(0, 5) : '—'}</dd>
            <dt>Bairro</dt>
            <dd>{user.neighborhood || '—'}</dd>
            <dt>Batizado</dt>
            <dd>{user.baptized === null ? '—' : user.baptized ? 'Sim' : 'Não'}</dd>
          </dl>
        )}
      </div>
    </Sheet>
  );
}

// ======================= ANIVERSARIANTES (liderança) =======================

export function AdminBirthdays() {
  return (
    <RoleOnly need="leader">
      <AdminBirthdaysInner />
    </RoleOnly>
  );
}

function AdminBirthdaysInner() {
  const { church } = useSession();
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const { data } = useApi<{ people: { id: number; name: string; phone: string | null; birthday: string; picture: string | null }[] }>(`/admin/aniversariantes?mes=${month}`);
  const today = todayYmd().slice(5);
  return (
    <Page title="Aniversariantes" back="/admin">
      <div className="stack">
        <Chips value={String(month)} onChange={(v) => setMonth(Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m[0].toUpperCase() + m.slice(1, 3) }))} />
        {data && !data.people.length && <Empty icon={<Cake />} title={`Nenhum aniversariante cadastrado em ${MONTHS[month - 1]}`} />}
        {data && data.people.length > 0 && (
          <div className="card">
            <div className="list">
              {data.people.map((p) => {
                const isToday = p.birthday.slice(5) === today;
                return (
                  <div key={p.id} className="list-item" style={{ cursor: 'default', background: isToday ? 'var(--gold-soft)' : undefined }}>
                    <Avatar name={p.name} picture={p.picture} />
                    <div className="grow">
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div className="small muted">
                        {p.birthday.slice(8, 10)}/{p.birthday.slice(5, 7)}
                        {isToday ? ' · hoje' : ''}
                      </div>
                    </div>
                    {p.phone && (
                      <a
                        className="btn btn-soft btn-sm"
                        href={phoneLink(p.phone, `Feliz aniversário, ${p.name.split(' ')[0]}! A família ${church.short} celebra a sua vida. Deus te abençoe!`)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <MessageCircle /> Parabéns
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

// ======================= VISITANTES =======================

interface Visitor {
  id: number;
  name: string;
  phone: string | null;
  neighborhood: string | null;
  first_time: number | null;
  how_found: string | null;
  prayer: string | null;
  wants_contact: number;
  status: string;
  notes: string | null;
  created_at: number;
}

export function AdminVisitors() {
  return (
    <RoleOnly need="leader">
      <AdminVisitorsInner />
    </RoleOnly>
  );
}

function AdminVisitorsInner() {
  const { church } = useSession();
  const { data, error, reload, mutate } = useApi<{ visitors: Visitor[] }>('/visitantes');
  const [filter, setFilter] = useState('novo');
  const list = (data?.visitors ?? []).filter((v) => filter === 'todos' || v.status === filter);
  const update = async (v: Visitor, status: string, notes = v.notes) => {
    try {
      await api(`/visitantes/${v.id}`, { method: 'PATCH', body: { status, notes } });
      mutate((d) => ({ ...d, visitors: d.visitors.map((x) => (x.id === v.id ? { ...x, status, notes } : x)) }));
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <Page title="Visitantes" back="/admin">
      <div className="stack">
        <Chips
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'novo', label: 'Novos' },
            { value: 'contatado', label: 'Contatados' },
            { value: 'membro', label: 'Viraram membros' },
            { value: 'todos', label: 'Todos' },
          ]}
        />
        {error && <ErrorBox error={error} retry={reload} />}
        {data && !list.length && <Empty icon={<UserPlus />} title="Nenhum visitante aqui" text="Os cartões preenchidos no app aparecem nesta lista." />}
        {list.map((v) => (
          <article key={v.id} className="card card-pad stack" style={{ gap: 8 }}>
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 650 }}>{v.name}</div>
                <div className="small muted">
                  {ago(v.created_at)}
                  {v.first_time ? ' · primeira vez' : ''}
                  {v.neighborhood ? ` · ${v.neighborhood}` : ''}
                </div>
              </div>
              <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 34px 4px 10px', fontSize: 14 }} value={v.status} onChange={(e) => void update(v, e.target.value)} aria-label="Situação">
                <option value="novo">Novo</option>
                <option value="contatado">Contatado</option>
                <option value="membro">Virou membro</option>
                <option value="arquivado">Arquivado</option>
              </select>
            </div>
            {v.how_found && <div className="small">Conheceu: {v.how_found}</div>}
            {v.prayer && (
              <div className="alert small">
                <MessageCircle />
                <span className="pre">Oração: {v.prayer}</span>
              </div>
            )}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {v.phone && (
                <a className="btn btn-soft btn-sm" href={phoneLink(v.phone, `Olá, ${v.name.split(' ')[0]}! Aqui é da ${church.short}. Que alegria ter você com a gente!`)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle /> {v.phone}
                </a>
              )}
              {!v.wants_contact && v.phone && <span className="badge">Não pediu contato</span>}
              <span className="grow" />
              <button
                className="icon-btn"
                aria-label="Apagar"
                onClick={async () => {
                  if (!(await confirmDialog({ title: `Apagar o cartão de ${v.name}?`, confirmLabel: 'Apagar', danger: true }))) return;
                  try {
                    await api(`/visitantes/${v.id}`, { method: 'DELETE' });
                    mutate((d) => ({ ...d, visitors: d.visitors.filter((x) => x.id !== v.id) }));
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

// ======================= PEDIDOS PARA GRUPOS =======================

export function AdminRequests() {
  return (
    <RoleOnly need="leader">
      <AdminRequestsInner />
    </RoleOnly>
  );
}

function AdminRequestsInner() {
  const { data, error, reload, mutate } = useApi<{
    requests: { id: number; ministry_name: string; user_name: string; phone: string | null; email: string; neighborhood: string | null; message: string | null; status: string; created_at: number }[];
  }>('/ministerios/pedidos');
  return (
    <Page title="Pedidos para grupos" back="/grupos">
      <div className="stack">
        {error && <ErrorBox error={error} retry={reload} />}
        {data && !data.requests.length && <Empty icon={<ClipboardList />} title="Nenhum pedido" text="Quando alguém tocar em “Quero participar” num grupo, aparece aqui." />}
        {data?.requests.map((r) => (
          <article key={r.id} className="card card-pad stack" style={{ gap: 8, opacity: r.status === 'arquivado' ? 0.6 : 1 }}>
            <div className="row-between">
              <div>
                <div style={{ fontWeight: 650 }}>{r.user_name}</div>
                <div className="small muted">
                  {r.ministry_name} · {ago(r.created_at)}
                  {r.neighborhood ? ` · ${r.neighborhood}` : ''}
                </div>
              </div>
              <select
                className="select"
                style={{ width: 'auto', minHeight: 36, padding: '4px 34px 4px 10px', fontSize: 14 }}
                value={r.status}
                aria-label="Situação"
                onChange={async (e) => {
                  const status = e.target.value;
                  try {
                    await api(`/ministerios/pedidos/${r.id}`, { method: 'PATCH', body: { status } });
                    mutate((d) => ({ ...d, requests: d.requests.map((x) => (x.id === r.id ? { ...x, status } : x)) }));
                  } catch (err) {
                    toastError(err);
                  }
                }}
              >
                <option value="novo">Novo</option>
                <option value="contatado">Contatado</option>
                <option value="arquivado">Arquivado</option>
              </select>
            </div>
            {r.message && <p className="small pre">{r.message}</p>}
            {r.phone && (
              <a className="btn btn-soft btn-sm" style={{ alignSelf: 'flex-start' }} href={phoneLink(r.phone, `Olá, ${r.user_name.split(' ')[0]}! Vi seu pedido para participar de ${r.ministry_name}.`)} target="_blank" rel="noopener noreferrer">
                <MessageCircle /> {r.phone}
              </a>
            )}
          </article>
        ))}
      </div>
    </Page>
  );
}

// ======================= NOTIFICAÇÃO MANUAL =======================

export function AdminNotify() {
  return (
    <RoleOnly need="leader">
      <AdminNotifyInner />
    </RoleOnly>
  );
}

function AdminNotifyInner() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('members');
  const [url, setUrl] = useState('/');
  const { data, reload } = useApi<{ notifications: { id: number; title: string; body: string | null; audience: string; topic: string; sent: number; failed: number; done: number; created_at: number; author_name: string | null }[] }>('/admin/notificacoes');
  const { busy, run } = useAction();
  const AUD: Record<string, string> = { all: 'Todos', members: 'Membros', leaders: 'Liderança', admins: 'Administradores', media: 'Mídia' };
  return (
    <Page title="Enviar notificação" back="/admin">
      <div className="stack-lg">
        <div className="card card-pad stack">
          <TextField label="Título" value={title} onChange={setTitle} maxLength={80} placeholder="Ex.: Culto especial hoje!" />
          <TextField label="Mensagem" value={body} onChange={setBody} multiline rows={3} maxLength={240} />
          <div className="form-grid collapse">
            <SelectField
              label="Para quem"
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'members', label: 'Membros' },
                { value: 'all', label: 'Todos (membros e visitantes)' },
                { value: 'leaders', label: 'Só a liderança' },
              ]}
            />
            <SelectField
              label="Ao tocar, abrir"
              value={url}
              onChange={setUrl}
              options={[
                { value: '/', label: 'Início' },
                { value: '/ao-vivo', label: 'Ao vivo' },
                { value: '/agenda', label: 'Agenda' },
                { value: '/avisos', label: 'Avisos' },
                { value: '/fotos', label: 'Fotos' },
                { value: '/oracao', label: 'Oração' },
                { value: '/dizimos', label: 'Dízimos e ofertas' },
                { value: '/campanhas', label: 'Campanhas' },
              ]}
            />
          </div>
          <p className="tiny muted">Chega para quem ativou as notificações no celular e escolheu receber "Avisos".</p>
          <Button
            icon={<Send />}
            loading={busy}
            onClick={() =>
              void run(async () => {
                if (!(await confirmDialog({ title: 'Enviar agora?', text: `"${title}" para ${AUD[audience].toLowerCase()}.`, confirmLabel: 'Enviar' }))) return;
                await api('/admin/notificar', { method: 'POST', body: { title, body, audience, url } });
                setTitle('');
                setBody('');
                await helpDrain();
                void reload();
                toast('Notificação enviada!', 'ok');
              })
            }
          >
            Enviar notificação
          </Button>
        </div>
        <Section title="Enviadas recentemente" action={<button className="link-btn row" style={{ gap: 4 }} onClick={() => void reload()}><RefreshCw size={14} /> Atualizar</button>}>
          <div className="card">
            <div className="list">
              {(data?.notifications ?? []).map((n) => (
                <div key={n.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{n.title}</div>
                    {n.body && <div className="small" style={{ color: 'var(--ink-2)' }}>{n.body}</div>}
                    <div className="tiny muted mt-1">
                      {ago(n.created_at)} · {AUD[n.audience] ?? 'Pessoal'}
                      {n.author_name ? ` · ${n.author_name}` : ''}
                    </div>
                  </div>
                  <span className={`badge ${n.done ? 'ok' : 'warn'}`}>{n.done ? `${n.sent} entregue${n.sent === 1 ? '' : 's'}` : 'Enviando…'}</span>
                </div>
              ))}
              {data && !data.notifications.length && <div className="list-item muted">Nenhuma ainda.</div>}
            </div>
          </div>
        </Section>
      </div>
    </Page>
  );
}

// ======================= CONTRIBUIÇÕES (tesouraria) =======================

export function AdminContributions() {
  return (
    <RoleOnly need="admin">
      <AdminContributionsInner />
    </RoleOnly>
  );
}

function AdminContributionsInner() {
  const [params, setParams] = useSearchParams();
  const now = todayYmd();
  const month = params.get('mes') ?? now.slice(0, 7);
  const status = params.get('status') ?? '';
  const [q, setQ] = useState('');
  const qs = new URLSearchParams({ mes: month });
  if (status) qs.set('status', status);
  if (q.trim()) qs.set('q', q.trim());
  const { data, error, reload, mutate } = useApi<{ contributions: Contribution[]; total_cents: number; by_type: Record<string, number>; pending: number }>(`/admin/contribuicoes?${qs}`);
  const year = Number(month.slice(0, 4));
  const summary = useApi<{ year: number; rows: { month: string; type: string; total: number }[] }>(`/admin/contribuicoes/resumo?ano=${year}`);
  const [adding, setAdding] = useState(false);
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    setParams(p, { replace: true });
  };
  const review = async (c: Contribution, st: Contribution['status']) => {
    try {
      await api(`/admin/contribuicoes/${c.id}`, { method: 'PATCH', body: { status: st } });
      mutate((d) => ({ ...d, contributions: d.contributions.map((x) => (x.id === c.id ? { ...x, status: st } : x)) }));
      void summary.reload();
    } catch (e) {
      toastError(e);
    }
  };

  const chart = useMemo(() => {
    const rows = summary.data?.rows ?? [];
    const totals: Record<string, number> = {};
    for (const r of rows) totals[r.type] = (totals[r.type] ?? 0) + r.total;
    const main = Object.keys(totals)
      .sort((a, b) => totals[b] - totals[a])
      .slice(0, 3);
    const series = [
      ...main.map((t, i) => ({ key: t, label: t, color: `var(--series-${i + 1})` })),
      ...(Object.keys(totals).length > 3 ? [{ key: '__outros', label: 'Outros', color: 'var(--series-other)' }] : []),
    ];
    const chartRows: ChartRow[] = Array.from({ length: 12 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      const values: Record<string, number> = {};
      for (const r of rows.filter((x) => x.month === key)) {
        const k = main.includes(r.type) ? r.type : '__outros';
        values[k] = (values[k] ?? 0) + r.total;
      }
      return { label: MONTHS_SHORT[m], full: `${MONTHS[m]} de ${year}`, values };
    });
    return { series, rows: chartRows };
  }, [summary.data, year]);

  return (
    <Page
      title="Contribuições"
      back="/admin"
      actions={
        <a className="icon-btn" href={`/api/admin/contribuicoes.csv?ano=${year}`} aria-label={`Baixar planilha de ${year}`} title={`Baixar planilha de ${year} (CSV)`}>
          <Download />
        </a>
      }
    >
      <div className="stack-lg">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input className="input" type="month" value={month} onChange={(e) => set('mes', e.target.value)} style={{ width: 'auto' }} aria-label="Mês" />
          <Chips
            value={status}
            onChange={(v) => set('status', v)}
            options={[
              { value: '', label: 'Todas' },
              { value: 'informado', label: `A conferir${data?.pending ? ` (${data.pending})` : ''}` },
              { value: 'conferido', label: 'Conferidas' },
              { value: 'recusado', label: 'Não localizadas' },
            ]}
          />
        </div>
        {data && (
          <div className="stat-grid">
            <StatTile label={`Total de ${MONTHS[Number(month.slice(5)) - 1]}`} value={money(data.total_cents)} />
            {Object.entries(data.by_type).map(([t, v]) => (
              <StatTile key={t} label={t} value={money(v)} />
            ))}
          </div>
        )}
        <div className="row-between">
          <div className="row grow" style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: 14, color: 'var(--ink-3)' }} />
            <input className="input" style={{ paddingLeft: 40 }} placeholder="Buscar pessoa" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button icon={<Plus />} onClick={() => setAdding(true)}>
            Lançar
          </Button>
        </div>
        {error && <ErrorBox error={error} retry={reload} />}
        {data && !data.contributions.length ? (
          <Empty icon={<Wallet />} title="Nenhuma contribuição neste filtro" />
        ) : (
          <div className="card">
            <div className="list">
              {data?.contributions.map((c) => (
                <div key={c.id} className="list-item" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 180 }}>
                    <div style={{ fontWeight: 620 }}>
                      {c.person ?? c.donor_name ?? 'Sem nome'} · {money(c.amount_cents)}
                    </div>
                    <div className="small muted">
                      {c.type} · {shortDate(c.given_on)} · {c.method}
                      {c.note ? ` · ${c.note}` : ''}
                    </div>
                    {c.receipt_id && (
                      <a className="small" href={mediaUrl(c.receipt_id)} target="_blank" rel="noopener noreferrer">
                        Ver comprovante
                      </a>
                    )}
                  </div>
                  {c.status === 'informado' ? (
                    <div className="row" style={{ gap: 6 }}>
                      <Button size="sm" variant="ok" icon={<Check />} onClick={() => void review(c, 'conferido')}>
                        Conferir
                      </Button>
                      <Button size="sm" variant="danger" icon={<X />} onClick={() => void review(c, 'recusado')} aria-label="Não localizado">
                        Não achei
                      </Button>
                    </div>
                  ) : (
                    <button className={`badge ${c.status === 'conferido' ? 'ok' : 'danger'}`} style={{ border: 0, cursor: 'pointer' }} onClick={() => void review(c, 'informado')} title="Voltar para 'a conferir'">
                      {c.status === 'conferido' ? 'Conferido' : 'Não localizado'}
                    </button>
                  )}
                  <button
                    className="icon-btn"
                    aria-label="Apagar lançamento"
                    onClick={async () => {
                      if (!(await confirmDialog({ title: 'Apagar este lançamento?', confirmLabel: 'Apagar', danger: true }))) return;
                      try {
                        await api(`/admin/contribuicoes/${c.id}`, { method: 'DELETE' });
                        void reload();
                        void summary.reload();
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <ColumnChart
          title={`Contribuições em ${year}`}
          subtitle="Por mês e por tipo (sem as não localizadas)"
          rows={chart.rows}
          series={chart.series.length ? chart.series : [{ key: 'x', label: 'Total', color: 'var(--series-1)' }]}
          format={(n) => money(n).replace(',00', '')}
          integer={false}
        />
      </div>
      {adding && (
        <ManualContribution
          onClose={() => setAdding(false)}
          onDone={() => {
            void reload();
            void summary.reload();
          }}
        />
      )}
    </Page>
  );
}

function ManualContribution({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const giving = useApi<{ types?: string[] }>('/dizimos');
  const members = useApi<{ users: AdminUser[] }>('/admin/membros?status=aprovado');
  const [userId, setUserId] = useState('');
  const [donor, setDonor] = useState('');
  const [type, setType] = useState('Dízimo');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayYmd());
  const [method, setMethod] = useState('dinheiro');
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const types = [...(giving.data?.types ?? ['Dízimo', 'Oferta']), 'Outro'];
  return (
    <Sheet
      open
      title="Lançar contribuição"
      onClose={onClose}
      footer={
        <Button
          block
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api('/admin/contribuicoes', {
                method: 'POST',
                body: { user_id: userId ? Number(userId) : null, donor_name: donor, type, amount, given_on: date, method, note },
              });
              onDone();
              onClose();
            }, 'Lançamento salvo.')
          }
        >
          Salvar
        </Button>
      }
    >
      <div className="stack">
        <SelectField
          label="Membro"
          value={userId}
          onChange={setUserId}
          options={[{ value: '', label: 'Não é membro do app / anônimo' }, ...(members.data?.users ?? []).map((u) => ({ value: String(u.id), label: u.name }))]}
        />
        {!userId && <TextField label="Nome (ou Anônimo)" value={donor} onChange={setDonor} maxLength={120} />}
        <div className="form-grid">
          <SelectField label="Tipo" value={type} onChange={setType} options={types.map((t) => ({ value: t, label: t }))} />
          <TextField label="Valor (R$)" value={amount} onChange={(v) => setAmount(v.replace(/[^\d,.]/g, ''))} inputMode="decimal" placeholder="50,00" />
        </div>
        <div className="form-grid">
          <TextField label="Data" type="date" value={date} onChange={setDate} />
          <SelectField
            label="Forma"
            value={method}
            onChange={setMethod}
            options={[
              { value: 'dinheiro', label: 'Dinheiro' },
              { value: 'pix', label: 'PIX' },
              { value: 'transferencia', label: 'Transferência' },
              { value: 'cartao', label: 'Cartão' },
              { value: 'boleto', label: 'Boleto' },
            ]}
          />
        </div>
        <TextField label="Observação" value={note} onChange={setNote} maxLength={300} placeholder="Ex.: envelope do culto de domingo" />
      </div>
    </Sheet>
  );
}

// ======================= RELATÓRIOS =======================

export function AdminReports() {
  return (
    <RoleOnly need="leader">
      <AdminReportsInner />
    </RoleOnly>
  );
}

function AdminReportsInner() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data, error, reload } = useApi<{ year: number; new_members: { month: string; n: number }[]; visitors: { month: string; n: number }[]; prayers: { month: string; n: number }[]; photos: { month: string; n: number }[]; lives: { month: string; n: number }[]; rsvps: { month: string; n: number }[] }>(`/admin/relatorios?ano=${year}`);
  const toRows = (list: { month: string; n: number }[] = []): ChartRow[] =>
    Array.from({ length: 12 }, (_, m) => {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`;
      return { label: MONTHS_SHORT[m], full: `${MONTHS[m]} de ${year}`, values: { n: list.find((x) => x.month === key)?.n ?? 0 } };
    });
  const one = [{ key: 'n', label: 'Total', color: 'var(--series-1)' }];
  const sum = (l: { n: number }[] = []) => l.reduce((s, x) => s + x.n, 0);
  return (
    <Page title="Relatórios" back="/admin">
      <div className="stack-lg">
        <Chips value={String(year)} onChange={(v) => setYear(Number(v))} options={[thisYear, thisYear - 1, thisYear - 2].map((y) => ({ value: String(y), label: String(y) }))} />
        {error && <ErrorBox error={error} retry={reload} />}
        {data && (
          <>
            <div className="stat-grid">
              <StatTile label="Novos cadastros" value={sum(data.new_members)} />
              <StatTile label="Visitantes (cartões)" value={sum(data.visitors)} />
              <StatTile label="Pedidos de oração" value={sum(data.prayers)} />
              <StatTile label="Fotos publicadas" value={sum(data.photos)} />
              <StatTile label="Lives" value={sum(data.lives)} />
              <StatTile label="Presenças confirmadas" value={sum(data.rsvps)} />
            </div>
            <ColumnChart title="Novos cadastros no app" subtitle={`Por mês, ${year}`} rows={toRows(data.new_members)} series={one} />
            <ColumnChart title="Visitantes" subtitle="Cartões do visitante preenchidos por mês" rows={toRows(data.visitors)} series={one} />
            <ColumnChart title="Pedidos de oração" subtitle="Por mês" rows={toRows(data.prayers)} series={one} />
            <ColumnChart title="Fotos publicadas" subtitle="Por mês" rows={toRows(data.photos)} series={one} />
            <ColumnChart title="Presenças confirmadas em eventos" subtitle="Pelo mês do evento" rows={toRows(data.rsvps)} series={one} />
          </>
        )}
      </div>
    </Page>
  );
}

// ======================= HISTÓRICO =======================

export function AdminAudit() {
  return (
    <RoleOnly need="admin">
      <AdminAuditInner />
    </RoleOnly>
  );
}

const AUDIT_LABEL: Record<string, string> = {
  cadastro: 'Novo cadastro',
  membro_alterado: 'Cadastro alterado',
  membro_excluido: 'Cadastro excluído',
  conta_excluida: 'Conta excluída pela pessoa',
  config_alterada: 'Configuração alterada',
  live_iniciada: 'Live iniciada',
  live_encerrada: 'Live encerrada',
  notificacao_enviada: 'Notificação enviada',
  contribuicao_alterada: 'Contribuição alterada',
  contribuicao_excluida: 'Contribuição excluída',
  exportou_contribuicoes: 'Planilha de contribuições baixada',
  exportou_membros: 'Planilha de membros baixada',
  foto_removida: 'Foto de membro removida',
  album_excluido: 'Álbum excluído',
  video_excluido: 'Vídeo excluído',
  evento_excluido: 'Evento excluído',
  campanha_excluida: 'Campanha excluída',
  ministerio_excluido: 'Grupo excluído',
  visitante_excluido: 'Cartão de visitante excluído',
  oracao_ocultada: 'Pedido de oração ocultado',
  oracao_reexibida: 'Pedido de oração reexibido',
};

function AdminAuditInner() {
  const { data, error, reload } = useApi<{ items: { id: number; action: string; detail: string | null; created_at: number; user_name: string | null }[] }>('/admin/auditoria');
  return (
    <Page title="Histórico de ações" back="/admin">
      {error && <ErrorBox error={error} retry={reload} />}
      <div className="card">
        <div className="list">
          {data?.items.map((a) => (
            <div key={a.id} className="list-item" style={{ cursor: 'default', alignItems: 'flex-start' }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{AUDIT_LABEL[a.action] ?? a.action}</div>
                {a.detail && <div className="small" style={{ color: 'var(--ink-2)' }}>{a.detail}</div>}
                <div className="tiny muted">
                  {ago(a.created_at)}
                  {a.user_name ? ` · ${a.user_name}` : ''}
                </div>
              </div>
            </div>
          ))}
          {data && !data.items.length && <div className="list-item muted">Nada registrado ainda.</div>}
        </div>
      </div>
    </Page>
  );
}

// ======================= CONFIGURAÇÕES =======================

interface Config {
  church: Church;
  schedule: ScheduleItem[];
  giving: Record<string, unknown> & { types: string[] };
  stream: { whip_url: string; whep_url: string };
  youtube: { auto_import: boolean; last_sync: number; last_result: string };
  reminders: { cult_minutes_before: number; event_minutes_before: number; word_hour: number; birthdays_to_leaders: boolean };
  storage_mode: 'r2' | 'd1';
  video_upload: boolean;
}

export function AdminConfig() {
  return (
    <RoleOnly need="admin">
      <AdminConfigInner />
    </RoleOnly>
  );
}

function AdminConfigInner() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') ?? 'igreja';
  const { data, error, reload } = useApi<Config>('/admin/config');
  const { refresh } = useSession();
  const saved = () => {
    void reload();
    void refresh();
  };
  return (
    <Page title="Configurações" back="/admin">
      <div className="stack-lg">
        <Chips
          value={tab}
          onChange={(v) => setParams({ aba: v }, { replace: true })}
          options={[
            { value: 'igreja', label: 'Igreja' },
            { value: 'horarios', label: 'Horários' },
            { value: 'dizimos', label: 'Dízimos' },
            { value: 'transmissao', label: 'Transmissão' },
            { value: 'youtube', label: 'YouTube' },
            { value: 'lembretes', label: 'Lembretes' },
            { value: 'armazenamento', label: 'Armazenamento' },
            { value: 'google', label: 'Login Google' },
          ]}
        />
        {error && <ErrorBox error={error} retry={reload} />}
        {!data ? (
          <LoadingList n={3} />
        ) : tab === 'igreja' ? (
          <ChurchForm c={data.church} onSaved={saved} />
        ) : tab === 'horarios' ? (
          <ScheduleForm items={data.schedule} onSaved={saved} />
        ) : tab === 'dizimos' ? (
          <GivingForm g={data.giving} onSaved={saved} />
        ) : tab === 'transmissao' ? (
          <StreamForm s={data.stream} onSaved={saved} />
        ) : tab === 'youtube' ? (
          <YoutubeForm cfg={data} onSaved={saved} />
        ) : tab === 'lembretes' ? (
          <RemindersForm r={data.reminders} onSaved={saved} />
        ) : tab === 'armazenamento' ? (
          <StorageInfo mode={data.storage_mode} />
        ) : (
          <GoogleInfo />
        )}
      </div>
    </Page>
  );
}

function useConfigSave(key: string, onSaved: () => void) {
  const { busy, run } = useAction();
  const save = (body: unknown) =>
    run(async () => {
      await api(`/admin/config/${key}`, { method: 'PUT', body });
      onSaved();
    }, 'Configuração salva.');
  return { busy, save };
}

function ChurchForm({ c, onSaved }: { c: Church; onSaved: () => void }) {
  const [f, setF] = useState(c);
  const { busy, save } = useConfigSave('church', onSaved);
  const [logoBusy, setLogoBusy] = useState(false);
  const set = (k: keyof Church) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    setLogoBusy(true);
    try {
      const imgs = await prepareIcons(file);
      const [logo, icon192, icon512, maskable] = await Promise.all([
        uploadImage(imgs.logo, 'logo'),
        uploadImage(imgs.icon192, 'icon'),
        uploadImage(imgs.icon512, 'icon'),
        uploadImage(imgs.maskable, 'icon'),
      ]);
      await api('/admin/config/church', { method: 'PUT', body: { logo_id: logo, icon192_id: icon192, icon512_id: icon512, maskable_id: maskable } });
      toast('Logo atualizada! O ícone do app muda na próxima instalação.', 'ok');
      onSaved();
    } catch (e) {
      toastError(e);
    } finally {
      setLogoBusy(false);
    }
  };
  return (
    <div className="stack">
      <div className="card card-pad row">
        <img src={`/api/brand/logo?v=${c.logo_id}`} alt="" width={64} height={64} style={{ borderRadius: 999, background: 'var(--surface-2)' }} />
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Logo da igreja</div>
          <div className="small muted">Use a logo oficial (quadrada, de preferência PNG). Ela vira o ícone do app.</div>
        </div>
        <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
          <ImagePlus /> {logoBusy ? 'Enviando…' : 'Trocar'}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void uploadLogo(e.target.files?.[0])} />
        </label>
      </div>
      <div className="card card-pad stack">
        <TextField label="Nome da igreja" value={f.name} onChange={set('name')} maxLength={200} />
        <div className="form-grid collapse">
          <TextField label="Sigla" value={f.short} onChange={set('short')} maxLength={20} />
          <TextField label="Subtítulo" value={f.subtitle} onChange={set('subtitle')} maxLength={200} />
        </div>
        <div className="form-grid collapse">
          <TextField label="Título do pastor" value={f.pastor_title} onChange={set('pastor_title')} maxLength={40} />
          <TextField label="Nome do pastor" value={f.pastor_name} onChange={set('pastor_name')} maxLength={120} />
        </div>
        <TextField label="Como chamar no app" value={f.pastor_display} onChange={set('pastor_display')} maxLength={80} hint='Ex.: "Bispo Ronaldo"' />
        <TextField label="Sobre a igreja" value={f.about} onChange={set('about')} multiline rows={5} maxLength={6000} hint="História, visão, missão. Aparece na página A igreja." />
      </div>
      <div className="card card-pad stack">
        <div style={{ fontWeight: 650 }}>Endereço</div>
        <TextField label="Rua e número" value={f.address} onChange={set('address')} maxLength={200} />
        <div className="form-grid collapse">
          <TextField label="Bairro" value={f.district} onChange={set('district')} maxLength={200} />
          <TextField label="Cidade/UF" value={f.city} onChange={set('city')} maxLength={200} />
        </div>
        <div className="form-grid collapse">
          <TextField label="CEP" value={f.cep} onChange={set('cep')} maxLength={20} />
          <TextField label="Link do Google Maps" value={f.maps_url} onChange={set('maps_url')} maxLength={200} inputMode="url" />
        </div>
      </div>
      <div className="card card-pad stack">
        <div style={{ fontWeight: 650 }}>Contatos e redes</div>
        <TextField label="WhatsApp da igreja (com DDD)" value={f.whatsapp} onChange={set('whatsapp')} maxLength={20} inputMode="tel" />
        <div className="form-grid collapse">
          <TextField label="Instagram da sede" value={f.instagram} onChange={set('instagram')} maxLength={60} />
          <TextField label="Instagram da Rede Jovem" value={f.instagram_youth} onChange={set('instagram_youth')} maxLength={60} />
        </div>
        <div className="form-grid collapse">
          <TextField label="Instagram de missões" value={f.instagram_missions} onChange={set('instagram_missions')} maxLength={60} />
          <TextField label="Facebook" value={f.facebook} onChange={set('facebook')} maxLength={60} />
        </div>
        <TextField label="Link do canal no YouTube" value={f.youtube_url} onChange={set('youtube_url')} maxLength={200} inputMode="url" />
        <TextField label="ID do canal do YouTube" value={f.youtube_channel_id} onChange={set('youtube_channel_id')} maxLength={30} hint="Começa com UC. Usado para mostrar as lives e importar os vídeos." />
        <TextField label="E-mail de contato (opcional)" value={f.email} onChange={set('email')} maxLength={120} inputMode="email" />
      </div>
      <Button loading={busy} onClick={() => void save(f)}>
        Salvar dados da igreja
      </Button>
    </div>
  );
}

function ScheduleForm({ items, onSaved }: { items: ScheduleItem[]; onSaved: () => void }) {
  const [list, setList] = useState(items);
  const { busy, save } = useConfigSave('schedule', onSaved);
  const upd = (i: number, k: keyof ScheduleItem, v: string | number) => setList((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="stack">
      <p className="small muted">Os cultos fixos da semana. Aparecem no início, na agenda e geram o lembrete automático.</p>
      {list.map((s, i) => (
        <div key={s.id} className="card card-pad stack" style={{ gap: 10 }}>
          <div className="form-grid">
            <SelectField label="Dia" value={String(s.weekday)} onChange={(v) => upd(i, 'weekday', Number(v))} options={WEEKDAYS.map((d, n) => ({ value: String(n), label: d }))} />
            <TextField label="Horário" type="time" value={s.time} onChange={(v) => upd(i, 'time', v)} />
          </div>
          <TextField label="Nome do culto" value={s.title} onChange={(v) => upd(i, 'title', v)} maxLength={60} />
          <TextField label="Observação (opcional)" value={s.note} onChange={(v) => upd(i, 'note', v)} maxLength={120} placeholder="Ex.: Culto de libertação" />
          <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
            Remover
          </Button>
        </div>
      ))}
      <Button variant="secondary" icon={<Plus />} onClick={() => setList((l) => [...l, { id: `h${Date.now()}`, weekday: 2, time: '20:00', title: 'Novo culto', note: '' }])}>
        Adicionar horário
      </Button>
      <Button loading={busy} onClick={() => void save({ items: list })}>
        Salvar horários
      </Button>
    </div>
  );
}

function GivingForm({ g, onSaved }: { g: Config['giving']; onSaved: () => void }) {
  const [f, setF] = useState<Record<string, string>>({
    holder_title: String(g.holder_title ?? ''),
    holder_name: String(g.holder_name ?? ''),
    pix_key_type: String(g.pix_key_type ?? ''),
    pix_key: String(g.pix_key ?? ''),
    pix_name: String(g.pix_name ?? ''),
    pix_city: String(g.pix_city ?? ''),
    bank_name: String(g.bank_name ?? ''),
    bank_code: String(g.bank_code ?? ''),
    agency: String(g.agency ?? ''),
    account: String(g.account ?? ''),
    account_type: String(g.account_type ?? 'corrente'),
    holder_doc: String(g.holder_doc ?? ''),
    message: String(g.message ?? ''),
    types: (g.types ?? []).join(', '),
  });
  const [visible, setVisible] = useState(g.visible_to === 'public');
  const { busy, save } = useConfigSave('giving', onSaved);
  const set = (k: string) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const preview = f.pix_key && f.pix_key_type ? pixPayload({ key: f.pix_key_type === 'telefone' ? `+55${f.pix_key.replace(/\D/g, '').replace(/^55/, '')}` : f.pix_key_type === 'cpf' || f.pix_key_type === 'cnpj' ? f.pix_key.replace(/\D/g, '') : f.pix_key, name: f.pix_name, city: f.pix_city, amountCents: parseCents('1,00'), txid: 'TESTE' }) : '';
  return (
    <div className="stack">
      <div className="alert">
        <Wallet />
        <span className="small">Estes dados aparecem na tela Dízimos e ofertas. Cadastre exatamente como estão no banco do {String(g.holder_title ?? '')} {String(g.holder_name ?? '')}.</span>
      </div>
      <div className="card card-pad stack">
        <div style={{ fontWeight: 650 }}>Favorecido</div>
        <div className="form-grid collapse">
          <TextField label="Título" value={f.holder_title} onChange={set('holder_title')} maxLength={40} />
          <TextField label="Nome completo do titular" value={f.holder_name} onChange={set('holder_name')} maxLength={120} />
        </div>
        <TextField label="CPF ou CNPJ do titular (opcional)" value={f.holder_doc} onChange={set('holder_doc')} maxLength={30} hint="Só mostre se o titular concordar." />
      </div>
      <div className="card card-pad stack">
        <div style={{ fontWeight: 650 }}>PIX</div>
        <div className="form-grid collapse">
          <SelectField
            label="Tipo de chave"
            value={f.pix_key_type}
            onChange={set('pix_key_type')}
            options={[
              { value: '', label: 'Sem PIX' },
              { value: 'cpf', label: 'CPF' },
              { value: 'cnpj', label: 'CNPJ' },
              { value: 'telefone', label: 'Celular' },
              { value: 'email', label: 'E-mail' },
              { value: 'aleatoria', label: 'Chave aleatória' },
            ]}
          />
          <TextField label="Chave PIX" value={f.pix_key} onChange={set('pix_key')} maxLength={77} />
        </div>
        <div className="form-grid collapse">
          <TextField label="Nome no PIX (até 25 letras)" value={f.pix_name} onChange={set('pix_name')} maxLength={25} hint="Sem acentos. Ex.: RONALDO NOGUEIRA" />
          <TextField label="Cidade (até 15 letras)" value={f.pix_city} onChange={set('pix_city')} maxLength={15} hint="Ex.: SAO PAULO" />
        </div>
        {preview && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="small" style={{ fontWeight: 650 }}>Teste antes de divulgar</div>
            <p className="tiny muted">Este código de teste é de R$ 1,00. Pague pelo app do banco e confira se cai na conta certa.</p>
            <Qr text={preview} />
            <CopyButton text={preview} label="Copiar código de teste" />
          </div>
        )}
      </div>
      <div className="card card-pad stack">
        <div style={{ fontWeight: 650 }}>Conta bancária (opcional)</div>
        <div className="form-grid collapse">
          <TextField label="Banco" value={f.bank_name} onChange={set('bank_name')} maxLength={80} placeholder="Ex.: Banco do Brasil" />
          <TextField label="Código do banco" value={f.bank_code} onChange={set('bank_code')} maxLength={10} placeholder="Ex.: 001" />
        </div>
        <div className="form-grid">
          <TextField label="Agência" value={f.agency} onChange={set('agency')} maxLength={20} />
          <TextField label="Conta" value={f.account} onChange={set('account')} maxLength={30} />
        </div>
        <SelectField
          label="Tipo de conta"
          value={f.account_type}
          onChange={set('account_type')}
          options={[
            { value: 'corrente', label: 'Corrente' },
            { value: 'poupanca', label: 'Poupança' },
            { value: 'pagamento', label: 'Conta de pagamento' },
          ]}
        />
      </div>
      <div className="card card-pad stack">
        <TextField label="Mensagem no topo" value={f.message} onChange={set('message')} maxLength={300} />
        <TextField label="Tipos de contribuição (separados por vírgula)" value={f.types} onChange={set('types')} maxLength={300} hint="Ex.: Dízimo, Oferta, Missões, Campanha" />
        <Toggle label="Mostrar para visitantes também" hint={visible ? 'Qualquer pessoa vê os dados.' : 'Só membros aprovados veem os dados.'} checked={visible} onChange={setVisible} />
      </div>
      <Button
        loading={busy}
        onClick={() =>
          void save({
            ...f,
            types: f.types
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean),
            visible_to: visible ? 'public' : 'members',
          })
        }
      >
        Salvar dados de contribuição
      </Button>
    </div>
  );
}

function StreamForm({ s, onSaved }: { s: Config['stream']; onSaved: () => void }) {
  const [whip, setWhip] = useState(s.whip_url);
  const [whep, setWhep] = useState(s.whep_url);
  const { busy, save } = useConfigSave('stream', onSaved);
  return (
    <div className="stack">
      <div className="card card-pad stack small" style={{ color: 'var(--ink-2)' }}>
        <div style={{ fontWeight: 650, color: 'var(--ink)' }}>Transmitir pela câmera do app (Cloudflare Stream)</div>
        <p>Assim a equipe de mídia faz a live direto do celular, sem passar pelo YouTube. A Cloudflare cobra por minuto assistido (cerca de US$ 1 a cada 1.000 minutos) e a live não fica gravada.</p>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>No painel da Cloudflare, abra Stream (assine o plano, se pedir).</li>
          <li>Vá em Live inputs → Create live input. Dê o nome "IRN".</li>
          <li>Abra a live input criada. Na aba WebRTC, copie a URL de Broadcast (WHIP) e a URL de Playback (WHEP).</li>
          <li>Cole as duas abaixo e salve. Pronto: aparece "Câmera do app" na tela Ao vivo.</li>
        </ol>
      </div>
      <div className="card card-pad stack">
        <TextField label="URL de transmissão (WHIP) — secreta" value={whip} onChange={setWhip} placeholder="https://customer-….cloudflarestream.com/…/webRTC/publish" hint="Quem tem esta URL consegue transmitir. Só a equipe de mídia recebe." />
        <TextField label="URL de reprodução (WHEP)" value={whep} onChange={setWhep} placeholder="https://customer-….cloudflarestream.com/…/webRTC/play" />
        <Button loading={busy} onClick={() => void save({ whip_url: whip, whep_url: whep })}>
          Salvar
        </Button>
      </div>
    </div>
  );
}

function YoutubeForm({ cfg, onSaved }: { cfg: Config; onSaved: () => void }) {
  const [auto, setAuto] = useState(cfg.youtube.auto_import);
  const { busy, save } = useConfigSave('youtube', onSaved);
  const { busy: syncing, run } = useAction();
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="small" style={{ color: 'var(--ink-2)' }}>
          Canal: <strong>{cfg.church.youtube_channel_id || 'não cadastrado'}</strong> (mude na aba Igreja)
        </div>
        <Toggle label="Importar sozinho os vídeos novos do canal" hint="A cada hora o app busca os vídeos novos do canal e coloca em Vídeos." checked={auto} onChange={setAuto} />
        {cfg.youtube.last_sync > 0 && (
          <div className="tiny muted">
            Última busca {ago(cfg.youtube.last_sync)}: {cfg.youtube.last_result}
          </div>
        )}
        <div className="row">
          <Button loading={busy} onClick={() => void save({ auto_import: auto })}>
            Salvar
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw />}
            loading={syncing}
            onClick={() =>
              void run(async () => {
                const r = await api<{ added: number }>('/videos/sincronizar', { method: 'POST' });
                toast(r.added ? `${r.added} vídeo(s) novo(s).` : 'Nenhum vídeo novo.', 'ok');
                onSaved();
              })
            }
          >
            Buscar agora
          </Button>
        </div>
      </div>
      <div className="card card-pad small stack" style={{ color: 'var(--ink-2)' }}>
        <div style={{ fontWeight: 650, color: 'var(--ink)' }}>Lives pelo YouTube</div>
        <p>
          Para transmitir pelo celular, o YouTube exige pelo menos 50 inscritos no canal (pelo computador, com OBS ou outro programa, não há esse mínimo).
          Depois de começar a live no YouTube, a equipe de mídia toca em "Estamos ao vivo" na tela Ao vivo do app: o vídeo aparece para todos e sai a
          notificação.
        </p>
      </div>
    </div>
  );
}

function RemindersForm({ r, onSaved }: { r: Config['reminders']; onSaved: () => void }) {
  const [cult, setCult] = useState(String(r.cult_minutes_before));
  const [ev, setEv] = useState(String(r.event_minutes_before));
  const [hour, setHour] = useState(String(r.word_hour));
  const [bday, setBday] = useState(r.birthdays_to_leaders);
  const { busy, save } = useConfigSave('reminders', onSaved);
  return (
    <div className="card card-pad stack">
      <SelectField
        label="Lembrete do culto"
        value={cult}
        onChange={setCult}
        options={[
          { value: '0', label: 'Não enviar' },
          { value: '30', label: '30 minutos antes' },
          { value: '60', label: '1 hora antes' },
          { value: '120', label: '2 horas antes' },
          { value: '180', label: '3 horas antes' },
        ]}
      />
      <SelectField
        label="Lembrete de evento"
        value={ev}
        onChange={setEv}
        options={[
          { value: '0', label: 'Não enviar' },
          { value: '60', label: '1 hora antes' },
          { value: '120', label: '2 horas antes' },
          { value: '1440', label: '1 dia antes' },
        ]}
      />
      <SelectField label="Notificação da Palavra do dia" value={hour} onChange={setHour} options={[5, 6, 7, 8, 9, 12].map((h) => ({ value: String(h), label: `Às ${h}h` }))} />
      <Toggle label="Avisar a liderança dos aniversariantes do dia" checked={bday} onChange={setBday} />
      <Button loading={busy} onClick={() => void save({ cult_minutes_before: Number(cult), event_minutes_before: Number(ev), word_hour: Number(hour), birthdays_to_leaders: bday })}>
        Salvar
      </Button>
    </div>
  );
}

function StorageInfo({ mode }: { mode: 'r2' | 'd1' }) {
  const { data } = useApi<Summary>('/admin/resumo');
  return (
    <div className="stack">
      <div className={`alert ${mode === 'r2' ? 'ok' : 'warn'}`}>
        {mode === 'r2' ? <Check /> : <Settings />}
        <span>
          {mode === 'r2'
            ? 'Armazenamento R2 ativo: fotos e vídeos ficam no R2 (10 GB grátis por mês, depois cerca de US$ 0,015 por GB).'
            : 'Sem R2: as fotos ficam no banco de dados (limite de 500 MB) e o envio de vídeos pelo app fica desligado.'}
          {data ? ` Usado até agora: ${bytes(data.storage_bytes)}.` : ''}
        </span>
      </div>
      {mode === 'd1' && (
        <div className="card card-pad small stack" style={{ color: 'var(--ink-2)' }}>
          <div style={{ fontWeight: 650, color: 'var(--ink)' }}>Como ativar o R2</div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>No painel da Cloudflare: Storage &amp; databases → R2 → ativar (pede um cartão, mas os primeiros 10 GB são grátis).</li>
            <li>No GitHub, abra o arquivo wrangler.jsonc e apague as duas barras ( // ) do começo da linha "r2_buckets".</li>
            <li>Salve (commit). A Cloudflare publica de novo sozinha e o envio de vídeos é liberado.</li>
          </ol>
          <p>As fotos que já estão no banco continuam funcionando normalmente.</p>
        </div>
      )}
    </div>
  );
}

function GoogleInfo() {
  const { features } = useSession();
  const redirect = `${location.origin}/api/auth/google/callback`;
  return (
    <div className="stack">
      <div className={`alert ${features.google ? 'ok' : 'warn'}`}>
        {features.google ? <Check /> : <Settings />}
        <span>{features.google ? 'Login com Google configurado.' : 'Login com Google ainda não configurado.'}</span>
      </div>
      <div className="card card-pad small stack" style={{ color: 'var(--ink-2)' }}>
        <div style={{ fontWeight: 650, color: 'var(--ink)' }}>Endereço de redirecionamento autorizado</div>
        <div className="pix-code">{redirect}</div>
        <CopyButton text={redirect} label="Copiar endereço" />
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          <li>Em console.cloud.google.com, crie um projeto "App IRN".</li>
          <li>Em Google Auth Platform: preencha a marca (nome do app, e-mail) e em Público escolha Externo e publique o app.</li>
          <li>Em Clientes → Criar cliente → Aplicativo da Web. Em "URIs de redirecionamento autorizados", cole o endereço acima.</li>
          <li>Copie o ID do cliente e a chave secreta. Na Cloudflare (Worker irn-app → Settings → Variables and Secrets), crie GOOGLE_CLIENT_ID (texto) e GOOGLE_CLIENT_SECRET (secreto).</li>
          <li>Opcional: crie ADMIN_EMAILS com os e-mails dos administradores, separados por vírgula.</li>
        </ol>
      </div>
    </div>
  );
}
