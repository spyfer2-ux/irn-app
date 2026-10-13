/** Entrar, aguardando aprovação, perfil, notificações, menu "Mais", aniversariantes. */
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  BellRing,
  BookOpen,
  BookOpenText,
  Cake,
  CalendarDays,
  Camera,
  ChevronRight,
  Church as ChurchIcon,
  ClipboardList,
  Clock,
  Film,
  HandCoins,
  HandHeart,
  History,
  Images,
  LogIn,
  LogOut,
  Megaphone,
  MessageSquareHeart,
  Radio,
  ScrollText,
  Send,
  Settings,
  Shield,
  Sparkles,
  Smartphone,
  Trash2,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { Me } from '../lib/types';
import { ago, MONTHS } from '../lib/format';
import { DEFAULT_TOPICS, isIos, isStandalone, pushStatus, pushSupported, subscribePush, TOPIC_LABELS, unsubscribePush } from '../lib/push';
import {
  Avatar,
  Button,
  Chips,
  Empty,
  ErrorBox,
  LoginPrompt,
  MembersOnly,
  Page,
  ROLE_LABEL,
  Section,
  SelectField,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';

// ======================= ENTRAR =======================

const LOGIN_ERRORS: Record<string, string> = {
  config: 'O login com Google ainda não foi configurado pelo administrador do app.',
  cancelado: 'O login foi cancelado.',
  expirou: 'O login demorou demais. Tente de novo.',
  google: 'O Google não confirmou o seu login. Tente de novo.',
  bloqueado: 'Seu acesso foi bloqueado. Fale com a liderança.',
};

export function Login() {
  const { user, isMember, church, features, refresh } = useSession();
  const [params] = useSearchParams();
  const voltar = params.get('voltar') || '/';
  const erro = params.get('erro');
  if (user && isMember) return <Navigate to={voltar} replace />;
  if (user && user.status === 'pendente') return <Navigate to="/aguardando" replace />;
  const href = `/api/auth/google/start?voltar=${encodeURIComponent(voltar)}`;
  return (
    <Page title="Entrar" back="/">
      <div className="stack-lg" style={{ maxWidth: 460, margin: '0 auto' }}>
        <div className="center stack" style={{ alignItems: 'center' }}>
          <img src="/api/brand/logo" alt="" width={88} height={88} style={{ borderRadius: 999, boxShadow: 'var(--shadow-2)' }} />
          <h1 style={{ fontSize: 25 }}>App da {church.short}</h1>
          <p style={{ color: 'var(--ink-2)' }}>Entre com a sua conta Google para participar da área dos membros.</p>
        </div>
        {erro && <div className="alert danger">{LOGIN_ERRORS[erro] ?? 'Não foi possível entrar.'}</div>}
        {features.google ? (
          <a className="btn btn-primary btn-block" href={href} style={{ minHeight: 52, fontSize: 16 }}>
            <LogIn /> Entrar com Google
          </a>
        ) : (
          <div className="alert warn">
            <Settings />
            <div className="small">
              <strong>Login com Google ainda não configurado.</strong> No painel da Cloudflare, cadastre as variáveis GOOGLE_CLIENT_ID e
              GOOGLE_CLIENT_SECRET. No Google Cloud, use este endereço de redirecionamento:
              <div className="pix-code mt-1">{`${location.origin}/api/auth/google/callback`}</div>
            </div>
          </div>
        )}
        <div className="card card-pad stack small" style={{ color: 'var(--ink-2)' }}>
          <div className="row">
            <span className="count-pill" style={{ background: 'var(--blue)' }}>1</span> Entre com sua conta Google.
          </div>
          <div className="row">
            <span className="count-pill" style={{ background: 'var(--blue)' }}>2</span> A liderança confere e aprova seu cadastro.
          </div>
          <div className="row">
            <span className="count-pill" style={{ background: 'var(--blue)' }}>3</span> Pronto: fotos, oração, agenda, dízimos e muito mais.
          </div>
        </div>
        {features.dev_login && <DevLogin onDone={() => void refresh()} />}
        <p className="tiny muted center">
          Ao entrar, você concorda com a nossa <Link to="/privacidade">política de privacidade</Link>.
        </p>
      </div>
    </Page>
  );
}

function DevLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('admin@teste.com');
  const [name, setName] = useState('Teste');
  const [role, setRole] = useState('');
  const { busy, run } = useAction();
  return (
    <div className="card card-pad stack" style={{ borderStyle: 'dashed' }}>
      <div className="small" style={{ fontWeight: 650 }}>Login de teste (só no computador de desenvolvimento)</div>
      <TextField label="E-mail" value={email} onChange={setEmail} />
      <TextField label="Nome" value={name} onChange={setName} />
      <SelectField
        label="Papel"
        value={role}
        onChange={setRole}
        options={[
          { value: '', label: 'Novo cadastro (pendente)' },
          { value: 'membro', label: 'Membro aprovado' },
          { value: 'midia', label: 'Equipe de mídia' },
          { value: 'lider', label: 'Liderança' },
          { value: 'admin', label: 'Administrador' },
        ]}
      />
      <Button
        variant="secondary"
        loading={busy}
        onClick={() =>
          void run(async () => {
            await api('/auth/dev', { method: 'POST', body: { email, name, ...(role ? { role, status: 'aprovado' } : {}) } });
            onDone();
          })
        }
      >
        Entrar como teste
      </Button>
    </div>
  );
}

// ======================= AGUARDANDO APROVAÇÃO =======================

export function Pending() {
  const { user, isMember, refresh, logout, church } = useSession();
  const [checking, setChecking] = useState(false);
  if (!user) return <Navigate to="/entrar" replace />;
  if (isMember) return <Navigate to="/" replace />;
  return (
    <Page title="Seu cadastro">
      <div className="stack-lg">
        <div className="card card-pad stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Avatar name={user.name} picture={user.picture} size={72} />
          <h1 style={{ fontSize: 23 }}>Olá, {user.name.split(' ')[0]}!</h1>
          {user.status === 'bloqueado' ? (
            <div className="alert danger">Seu acesso foi bloqueado. Fale com a liderança da igreja.</div>
          ) : (
            <>
              <span className="badge warn">
                <Clock size={13} /> Aguardando aprovação
              </span>
              <p style={{ color: 'var(--ink-2)' }}>
                Recebemos seu cadastro. A liderança da {church.short} vai conferir e liberar seu acesso. Enquanto isso, complete seus dados abaixo — isso
                ajuda a liderança a te reconhecer.
              </p>
              <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={checking}
                  onClick={async () => {
                    setChecking(true);
                    await refresh();
                    setChecking(false);
                  }}
                >
                  Já fui aprovado?
                </Button>
                <NotifyQuick />
              </div>
            </>
          )}
        </div>
        <ProfileForm user={user} intro />
        <Button variant="ghost" icon={<LogOut />} onClick={() => void logout()}>
          Sair
        </Button>
      </div>
    </Page>
  );
}

function NotifyQuick() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (pushSupported()) void pushStatus().then((s) => setOn(s.subscribed)).catch(() => setOn(false));
  }, []);
  if (!pushSupported() || on) return null;
  return (
    <Button
      size="sm"
      icon={<BellRing />}
      onClick={async () => {
        try {
          await subscribePush(DEFAULT_TOPICS);
          setOn(true);
          toast('Pronto! Você será avisado.', 'ok');
        } catch (e) {
          toastError(e);
        }
      }}
    >
      Avise-me no celular
    </Button>
  );
}

// ======================= PERFIL =======================

function ProfileForm({ user, intro }: { user: Me; intro?: boolean }) {
  const { setUser } = useSession();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [birthday, setBirthday] = useState(user.birthday ?? '');
  const [showBirthday, setShowBirthday] = useState(!!user.show_birthday);
  const [hood, setHood] = useState(user.neighborhood ?? '');
  const [baptized, setBaptized] = useState(user.baptized === null ? '' : user.baptized ? '1' : '0');
  const [since, setSince] = useState(user.member_since ?? '');
  const [about, setAbout] = useState(user.intro ?? '');
  const [terms, setTerms] = useState(!!user.accepted_terms_at);
  const { busy, run } = useAction();
  return (
    <form
      className="card card-pad stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await api<{ user: Me }>('/me', {
            method: 'PUT',
            body: {
              name,
              phone,
              birthday: birthday || null,
              show_birthday: showBirthday,
              neighborhood: hood,
              baptized: baptized === '' ? null : baptized === '1',
              member_since: since,
              intro: about,
              accept_terms: terms,
            },
          });
          setUser(r.user);
        }, 'Dados salvos.');
      }}
    >
      <div style={{ fontWeight: 650 }}>Meus dados</div>
      <TextField label="Nome" value={name} onChange={setName} maxLength={120} autoComplete="name" />
      <div className="form-grid collapse">
        <TextField label="Celular / WhatsApp" value={phone} onChange={setPhone} maxLength={30} inputMode="tel" autoComplete="tel" />
        <TextField label="Aniversário" type="date" value={birthday} onChange={setBirthday} />
      </div>
      <Toggle label="Mostrar meu aniversário para a igreja" hint="Só o dia e o mês." checked={showBirthday} onChange={setShowBirthday} />
      <div className="form-grid collapse">
        <TextField label="Bairro" value={hood} onChange={setHood} maxLength={80} />
        <SelectField
          label="Batizado(a) nas águas?"
          value={baptized}
          onChange={setBaptized}
          options={[
            { value: '', label: 'Prefiro não dizer' },
            { value: '1', label: 'Sim' },
            { value: '0', label: 'Ainda não' },
          ]}
        />
      </div>
      <TextField label="Frequento a IRN desde (ano)" value={since} onChange={setSince} maxLength={20} inputMode="numeric" />
      <TextField
        label={intro ? 'Conte um pouco sobre você' : 'Sobre mim'}
        value={about}
        onChange={setAbout}
        multiline
        rows={3}
        maxLength={600}
        hint={intro ? 'Ex.: há quanto tempo frequenta, quem te convidou, em qual célula está.' : undefined}
      />
      <Toggle label={<>Li e aceito a <Link to="/privacidade">política de privacidade</Link></>} checked={terms} onChange={setTerms} />
      <Button type="submit" loading={busy}>
        Salvar
      </Button>
    </form>
  );
}

let installEvent: (Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }) | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as typeof installEvent;
    installListeners.forEach((f) => f());
  });
}

export function InstallBanner({ full }: { full?: boolean }) {
  const [, force] = useState(0);
  const [hidden, setHidden] = useState(() => {
    try {
      const t = Number(localStorage.getItem('irn-install-hidden') || 0);
      return Date.now() - t < 14 * 86400000;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const f = () => force((x) => x + 1);
    installListeners.add(f);
    return () => {
      installListeners.delete(f);
    };
  }, []);
  if (isStandalone()) return full ? <div className="alert ok"><Smartphone /><span>O app já está instalado neste aparelho.</span></div> : null;
  if (!full && hidden) return null;
  const ios = isIos();
  if (!installEvent && !ios && !full) return null;
  const hide = () => {
    try {
      localStorage.setItem('irn-install-hidden', String(Date.now()));
    } catch {
      /* ok */
    }
    setHidden(true);
  };
  return (
    <div className="card card-pad stack" style={{ gap: 10 }}>
      <div className="row">
        <div className="icon-tile">
          <Smartphone />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Instale o app no celular</div>
          <div className="small muted">Fica na tela inicial, abre mais rápido e recebe notificações.</div>
        </div>
      </div>
      {installEvent ? (
        <div className="row">
          <Button
            className="grow"
            onClick={async () => {
              await installEvent!.prompt();
              const r = await installEvent!.userChoice;
              if (r.outcome === 'accepted') toast('App instalado!', 'ok');
              installEvent = null;
              force((x) => x + 1);
            }}
          >
            Instalar
          </Button>
          {!full && (
            <Button variant="ghost" onClick={hide}>
              Agora não
            </Button>
          )}
        </div>
      ) : ios ? (
        <div className="small" style={{ color: 'var(--ink-2)' }}>
          No iPhone (Safari): toque em <strong>Compartilhar</strong> (quadrado com seta para cima) e depois em <strong>Adicionar à Tela de Início</strong>.
          {!full && (
            <div className="mt-1">
              <button className="link-btn small" onClick={hide}>
                Entendi
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="small" style={{ color: 'var(--ink-2)' }}>
          No Chrome: abra o menu (⋮) e toque em <strong>Instalar app</strong> ou <strong>Adicionar à tela inicial</strong>.
        </div>
      )}
    </div>
  );
}

export function NotificationSettings() {
  const { isMember } = useSession();
  const [state, setState] = useState<{ subscribed: boolean; topics: string[] } | null>(null);
  const { busy, run } = useAction();
  const supported = pushSupported();
  useEffect(() => {
    if (supported) void pushStatus().then(setState).catch(() => setState({ subscribed: false, topics: [] }));
  }, [supported]);

  if (!supported)
    return (
      <div className="alert warn">
        <Bell />
        <span className="small">
          {isIos() && !isStandalone()
            ? 'No iPhone, as notificações funcionam com o app instalado: Compartilhar → Adicionar à Tela de Início. Depois abra pelo ícone e ative aqui.'
            : 'Este navegador não recebe notificações. Use o Chrome (Android) ou instale o app no iPhone.'}
        </span>
      </div>
    );
  if (!state) return null;
  const topics = Object.entries(TOPIC_LABELS).filter(([, t]) => !t.members || isMember);
  const setTopic = (k: string, on: boolean) =>
    run(async () => {
      const next = on ? [...new Set([...state.topics, k])] : state.topics.filter((t) => t !== k);
      await subscribePush(next);
      setState({ subscribed: true, topics: next });
    });
  return state.subscribed ? (
    <div className="card card-pad stack">
      <div className="row-between">
        <div style={{ fontWeight: 650 }}>Notificações ligadas neste aparelho</div>
        <span className="badge ok">Ativas</span>
      </div>
      {topics.map(([k, t]) => (
        <Toggle key={k} label={t.label} hint={t.hint} checked={state.topics.includes(k)} onChange={(v) => void setTopic(k, v)} />
      ))}
      <Button
        variant="ghost"
        size="sm"
        loading={busy}
        onClick={() =>
          void run(async () => {
            await unsubscribePush();
            setState({ subscribed: false, topics: [] });
          }, 'Notificações desligadas.')
        }
      >
        Desligar notificações
      </Button>
    </div>
  ) : (
    <div className="card card-pad stack">
      <div className="row">
        <div className="icon-tile">
          <BellRing />
        </div>
        <div className="grow">
          <div style={{ fontWeight: 650 }}>Receba avisos no celular</div>
          <div className="small muted">Lives, lembretes dos cultos, eventos e a Palavra do dia.</div>
        </div>
      </div>
      <Button
        loading={busy}
        icon={<BellRing />}
        onClick={() =>
          void run(async () => {
            await subscribePush(DEFAULT_TOPICS);
            setState({ subscribed: true, topics: DEFAULT_TOPICS });
          }, 'Notificações ativadas!')
        }
      >
        Ativar notificações
      </Button>
    </div>
  );
}

function ThemePicker() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('irn-theme') || 'auto';
    } catch {
      return 'auto';
    }
  });
  return (
    <Chips
      value={theme}
      onChange={(v) => {
        setTheme(v);
        try {
          if (v === 'auto') localStorage.removeItem('irn-theme');
          else localStorage.setItem('irn-theme', v);
        } catch {
          /* ok */
        }
        if (v === 'auto') document.documentElement.removeAttribute('data-theme');
        else document.documentElement.setAttribute('data-theme', v);
      }}
      options={[
        { value: 'auto', label: 'Automático' },
        { value: 'light', label: 'Claro' },
        { value: 'dark', label: 'Escuro' },
      ]}
    />
  );
}

export function Profile() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const loc = useLocation();
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    if (loc.hash === '#notificacoes') setTimeout(() => document.getElementById('notificacoes')?.scrollIntoView({ behavior: 'smooth' }), 200);
  }, [loc.hash]);
  if (!user)
    return (
      <Page title="Perfil">
        <div className="stack-lg">
          <LoginPrompt />
          <div id="notificacoes">
            <Section title="Notificações">
              <NotificationSettings />
            </Section>
          </div>
          <InstallBanner full />
        </div>
      </Page>
    );
  return (
    <Page title="Meu perfil">
      <div className="stack-lg">
        <div className="card card-pad row">
          <Avatar name={user.name} picture={user.picture} size={56} />
          <div className="grow">
            <div style={{ fontWeight: 700, fontSize: 17 }}>{user.name}</div>
            <div className="small muted ellipsis">{user.email}</div>
            <div className="wrap-row mt-1">
              <span className="badge blue">{ROLE_LABEL[user.role]}</span>
              {user.status !== 'aprovado' && <span className={`badge ${user.status === 'pendente' ? 'warn' : 'danger'}`}>{user.status === 'pendente' ? 'Aguardando aprovação' : 'Bloqueado'}</span>}
            </div>
          </div>
        </div>
        <ProfileForm user={user} />
        <div id="notificacoes">
          <Section title="Notificações">
            <NotificationSettings />
          </Section>
        </div>
        <InstallBanner full />
        <Section title="Aparência">
          <ThemePicker />
        </Section>
        <div className="card">
          <div className="list">
            <Link className="list-item" to="/dizimos">
              <Wallet size={20} className="muted" /> <span className="grow">Minhas contribuições</span> <ChevronRight className="chev" />
            </Link>
            <Link className="list-item" to="/oracao?filtro=meus">
              <HandHeart size={20} className="muted" /> <span className="grow">Meus pedidos de oração</span> <ChevronRight className="chev" />
            </Link>
            <Link className="list-item" to="/privacidade">
              <Shield size={20} className="muted" /> <span className="grow">Privacidade</span> <ChevronRight className="chev" />
            </Link>
          </div>
        </div>
        <Button
          variant="secondary"
          icon={<LogOut />}
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          Sair da conta
        </Button>
        <button className="link-btn small" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={() => setDeleting(true)}>
          Excluir minha conta
        </button>
      </div>
      {deleting && <DeleteAccount onClose={() => setDeleting(false)} />}
    </Page>
  );
}

function DeleteAccount({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const { busy, run } = useAction();
  return (
    <Sheet
      open
      small
      title="Excluir minha conta"
      onClose={onClose}
      footer={
        <Button
          variant="danger"
          block
          icon={<Trash2 />}
          disabled={text !== 'EXCLUIR'}
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api('/me/excluir', { method: 'POST', body: { confirm: text } });
              await refresh();
              navigate('/');
            }, 'Conta excluída.')
          }
        >
          Excluir definitivamente
        </Button>
      }
    >
      <div className="stack">
        <p className="small" style={{ color: 'var(--ink-2)' }}>
          Seus dados, pedidos de oração, testemunhos e confirmações serão apagados. As fotos que você publicou continuam na biblioteca, sem o seu nome
          (peça à liderança se quiser removê-las). Para confirmar, digite <strong>EXCLUIR</strong>.
        </p>
        <TextField label="Confirmação" value={text} onChange={setText} />
      </div>
    </Sheet>
  );
}

// ======================= CAIXA DE NOTIFICAÇÕES =======================

export function Inbox() {
  const { data, error, reload } = useApi<{ items: { id: number; topic: string; title: string; body: string | null; url: string | null; created_at: number }[] }>('/push/inbox');
  return (
    <Page title="Notificações" back="/">
      <div className="stack">
        <Link to="/perfil#notificacoes" className="card card-pad card-link row">
          <div className="icon-tile">
            <BellRing />
          </div>
          <div className="grow">
            <div style={{ fontWeight: 650 }}>Receber no celular</div>
            <div className="small muted">Escolha o que quer receber</div>
          </div>
          <ChevronRight className="chev" />
        </Link>
        {error && <ErrorBox error={error} retry={reload} />}
        {data && !data.items.length && <Empty icon={<Bell />} title="Nenhuma notificação recente" />}
        {data && data.items.length > 0 && (
          <div className="card">
            <div className="list">
              {data.items.map((n) => (
                <Link key={n.id} to={n.url || '/'} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <span className="notif-dot" style={{ marginTop: 7 }} />
                  <div className="grow">
                    <div style={{ fontWeight: 620 }}>{n.title}</div>
                    {n.body && <div className="small" style={{ color: 'var(--ink-2)' }}>{n.body}</div>}
                    <div className="tiny muted mt-1">{ago(n.created_at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

// ======================= MAIS =======================

export function More() {
  const { user, isMember, isMedia, isLeader, isAdmin, logout } = useSession();
  type Item = { to: string; label: string; icon: React.JSX.Element; tone?: string };
  const church: Item[] = [
    { to: '/ao-vivo', label: 'Ao vivo', icon: <Radio />, tone: 'live' },
    { to: '/videos', label: 'Vídeos', icon: <Film /> },
    { to: '/fotos', label: 'Fotos', icon: <Images /> },
    { to: '/agenda', label: 'Agenda', icon: <CalendarDays /> },
    { to: '/avisos', label: 'Avisos', icon: <Megaphone /> },
    { to: '/palavra', label: 'Palavra do dia', icon: <BookOpen />, tone: 'gold' },
    { to: '/biblia', label: 'Bíblia', icon: <BookOpenText />, tone: 'gold' },
    { to: '/campanhas', label: 'Campanhas', icon: <Sparkles />, tone: 'gold' },
    { to: '/grupos', label: 'Células e grupos', icon: <Users /> },
    { to: '/oracao', label: 'Pedidos de oração', icon: <HandHeart />, tone: 'gold' },
    { to: '/testemunhos', label: 'Testemunhos', icon: <MessageSquareHeart /> },
    { to: '/dizimos', label: 'Dízimos e ofertas', icon: <HandCoins />, tone: 'gold' },
    ...(isMember ? [{ to: '/aniversariantes', label: 'Aniversariantes', icon: <Cake /> }] : []),
    { to: '/igreja', label: 'A igreja', icon: <ChurchIcon /> },
    { to: '/visitante', label: 'Cartão do visitante', icon: <UserPlus /> },
  ];
  const team: Item[] = isMedia
    ? [
        { to: '/transmitir', label: 'Transmitir pela câmera', icon: <Camera />, tone: 'live' },
        { to: '/ao-vivo/historico', label: 'Histórico de lives', icon: <History /> },
      ]
    : [];
  const lead: Item[] = isLeader
    ? [
        { to: '/admin', label: 'Painel da liderança', icon: <Shield /> },
        { to: '/admin/membros', label: 'Membros e aprovações', icon: <Users /> },
        { to: '/admin/aniversariantes', label: 'Aniversariantes (com telefone)', icon: <Cake /> },
        { to: '/admin/visitantes', label: 'Visitantes', icon: <UserPlus /> },
        { to: '/admin/pedidos', label: 'Pedidos para grupos', icon: <ClipboardList /> },
        { to: '/admin/notificar', label: 'Enviar notificação', icon: <Send /> },
        { to: '/admin/relatorios', label: 'Relatórios', icon: <BarChart3 /> },
        ...(isAdmin
          ? [
              { to: '/admin/contribuicoes', label: 'Contribuições (tesouraria)', icon: <Wallet /> },
              { to: '/admin/config', label: 'Configurações do app', icon: <Settings /> },
              { to: '/admin/auditoria', label: 'Histórico de ações', icon: <ScrollText /> },
            ]
          : []),
      ]
    : [];
  const List = ({ items }: { items: Item[] }) => (
    <div className="card">
      <div className="list">
        {items.map((i) => (
          <Link key={i.to} to={i.to} className="list-item">
            <span className={`icon-tile ${i.tone ?? ''}`} style={{ width: 36, height: 36, borderRadius: 11 }}>
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
  );
  return (
    <Page title="Mais">
      <div className="stack-lg">
        {user ? (
          <Link to="/perfil" className="card card-pad card-link row">
            <Avatar name={user.name} picture={user.picture} size={46} />
            <div className="grow">
              <div style={{ fontWeight: 650 }}>{user.name}</div>
              <div className="small muted">{ROLE_LABEL[user.role]} · Ver meu perfil</div>
            </div>
            <ChevronRight className="chev" />
          </Link>
        ) : (
          <Link to="/entrar" className="btn btn-primary btn-block">
            <LogIn /> Entrar com Google
          </Link>
        )}
        <Section title="Igreja">
          <List items={church} />
        </Section>
        {team.length > 0 && (
          <Section title="Equipe de mídia">
            <List items={team} />
          </Section>
        )}
        {lead.length > 0 && (
          <Section title="Liderança">
            <List items={lead} />
          </Section>
        )}
        <Section title="Conta">
          <List
            items={[
              { to: '/notificacoes', label: 'Notificações', icon: <Bell /> },
              { to: '/perfil', label: user ? 'Meu perfil' : 'Instalar e notificações', icon: <Smartphone /> },
              { to: '/privacidade', label: 'Privacidade', icon: <Shield /> },
            ]}
          />
        </Section>
        {user && (
          <Button variant="ghost" icon={<LogOut />} onClick={() => void logout()}>
            Sair
          </Button>
        )}
      </div>
    </Page>
  );
}

// ======================= ANIVERSARIANTES =======================

export function Birthdays() {
  return (
    <MembersOnly>
      <BirthdaysInner />
    </MembersOnly>
  );
}

function BirthdaysInner() {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const { data, error, reload } = useApi<{ month: number; today: string | null; people: { id: number; name: string; picture: string | null; day: string }[] }>(`/aniversariantes?mes=${month}`);
  return (
    <Page title="Aniversariantes" back>
      <div className="stack">
        <Chips value={String(month)} onChange={(v) => setMonth(Number(v))} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m[0].toUpperCase() + m.slice(1, 3) }))} />
        {error && <ErrorBox error={error} retry={reload} />}
        {data && !data.people.length && <Empty icon={<Cake />} title={`Ninguém cadastrado em ${MONTHS[month - 1]}`} text="Coloque seu aniversário no perfil para aparecer aqui." />}
        {data && data.people.length > 0 && (
          <div className="card">
            <div className="list">
              {data.people.map((p) => (
                <div key={p.id} className="list-item" style={{ cursor: 'default', background: data.today === p.day ? 'var(--gold-soft)' : undefined }}>
                  <Avatar name={p.name} picture={p.picture} />
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div className="small muted">
                      {p.day}/{String(month).padStart(2, '0')}
                      {data.today === p.day ? ' · hoje!' : ''}
                    </div>
                  </div>
                  {data.today === p.day && <Cake style={{ color: 'var(--gold)' }} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}

export function NotFound() {
  return (
    <Page title="Página não encontrada" back="/">
      <Empty
        icon={<ChurchIcon />}
        title="Não encontramos esta página"
        action={
          <Link className="btn btn-primary" to="/">
            Voltar ao início
          </Link>
        }
      />
    </Page>
  );
}
