/**
 * Tela "Transmitir": qualquer membro aprovado faz a live pela câmera do celular, no canal do YouTube da própria
 * conta Google. A live aparece na tela Ao vivo do app para todos (com notificação) assim que o vídeo chega ao YouTube.
 * Para celulares que não conseguem transmitir pelo app, há a opção de transmitir por outro app (Larix, Streamlabs).
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  LogIn,
  Mic,
  MicOff,
  Radio,
  RefreshCw,
  Smartphone,
  Square,
  SwitchCamera,
  TriangleAlert,
  Unplug,
  X,
} from 'lucide-react';
import { api, ApiError, errMsg, useApi } from '../lib/api';
import { WEEKDAYS } from '../lib/format';
import { helpDrain } from '../lib/push';
import {
  cameraError,
  castSupport,
  LiveCaster,
  QUALITIES,
  type CastPhase,
  type CastStats,
  type CastSupport,
  type Facing,
  type Quality,
} from '../lib/livecast';
import { Button, confirmDialog, CopyButton, LoadingList, MembersOnly, Seg, TextField, Toggle, toast, toastError } from '../components/ui';
import { refreshLive, useLiveState } from '../components/Layout';

interface SessionView {
  id: number;
  status: 'preparada' | 'no_ar' | 'encerrada';
  mode: 'app' | 'externo';
  title: string;
  privacy: 'public' | 'unlisted';
  notify: boolean;
  broadcast_id: string;
  watch_url: string;
  studio_url: string;
  created_at: number;
  rtmp: { url: string; key: string } | null;
}

interface Account {
  configured: boolean;
  relay: boolean;
  connected: boolean;
  email: string | null;
  channel: { id: string; title: string; thumb: string | null } | null;
  session: SessionView | null;
  busy: boolean;
}

interface Problem {
  code?: string;
  message: string;
}

const CONNECT_URL = `/api/auth/youtube/start?voltar=${encodeURIComponent('/ao-vivo/transmitir')}`;

const YT_RETURN: Record<string, { kind: 'ok' | 'error' | 'info'; text: string }> = {
  ok: { kind: 'ok', text: 'YouTube conectado!' },
  sem_canal: { kind: 'info', text: 'Conta conectada, mas ela ainda não tem canal no YouTube.' },
  sem_permissao: { kind: 'error', text: 'Faltou marcar a permissão do YouTube na tela do Google. Conecte de novo e deixe marcada.' },
  cancelado: { kind: 'info', text: 'Conexão com o YouTube cancelada.' },
  expirou: { kind: 'error', text: 'A conexão demorou demais. Tente de novo.' },
  api_desligada: { kind: 'error', text: 'A API do YouTube ainda não foi ativada no Google Cloud do app. Avise o administrador.' },
  config: { kind: 'error', text: 'O login com Google ainda não foi configurado no app.' },
  erro: { kind: 'error', text: 'Não consegui conectar ao YouTube. Tente de novo.' },
};

function wsUrl(sessionId: number) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/relay?sessao=${sessionId}`;
}

function larixLink(full: string, quality: Quality) {
  const q = QUALITIES[quality];
  return (
    `larix://set/v1?conn[][url]=${encodeURIComponent(full)}&conn[][name]=${encodeURIComponent('YouTube (app da igreja)')}` +
    `&conn[][mode]=av&conn[][overwrite]=on&enc[vid][res]=${q.w}x${q.h}&enc[vid][fps]=30&enc[vid][bitrate]=${q.kbps}` +
    `&enc[vid][keyframe]=2&enc[aud][bitrate]=128&enc[aud][channels]=2`
  );
}

export default function Broadcast() {
  const navigate = useNavigate();
  return (
    <div className="studio" role="dialog" aria-label="Transmitir">
      <div className="studio-in">
        <div className="studio-top">
          <h1>Transmitir</h1>
          <button className="icon-btn" aria-label="Fechar" onClick={() => navigate('/ao-vivo')}>
            <X />
          </button>
        </div>
        <MembersOnly text="Entre com sua conta Google para fazer uma live.">
          <Studio />
        </MembersOnly>
      </div>
    </div>
  );
}

function Studio() {
  const navigate = useNavigate();
  const loc = useLocation();
  const { data: acc, error, reload } = useApi<Account>('/live/youtube/conta');

  // Volta da tela do Google (…?yt=ok)
  useEffect(() => {
    const yt = new URLSearchParams(loc.search).get('yt');
    if (!yt) return;
    const r = YT_RETURN[yt] ?? YT_RETURN.erro;
    toast(r.text, r.kind === 'ok' ? 'ok' : r.kind === 'error' ? 'error' : 'info');
    navigate('/ao-vivo/transmitir', { replace: true });
  }, [loc.search, navigate]);

  if (error) return <div className="alert danger">{error.message}</div>;
  if (!acc) return <LoadingList n={2} h={120} />;
  if (!acc.configured) return <div className="alert warn">O login com Google ainda não foi configurado no app. Avise o administrador.</div>;
  if (!acc.connected) return <ConnectCard />;
  if (!acc.channel) return <NoChannel email={acc.email} onChecked={reload} />;
  return <Ready acc={acc} reload={reload} />;
}

function ConnectCard({ again }: { again?: boolean }) {
  return (
    <div className="card card-pad stack">
      <div style={{ fontWeight: 700, fontSize: 17 }}>{again ? 'Conecte o YouTube de novo' : 'Conecte o seu YouTube'}</div>
      <p className="small" style={{ color: 'var(--ink-2)' }}>
        A live sai no canal do YouTube da sua conta Google e aparece aqui no app para todo mundo, com notificação. Não precisa da senha do canal
        da igreja.
      </p>
      <a className="btn btn-primary btn-block" href={CONNECT_URL}>
        <LogIn /> Conectar minha conta do YouTube
      </a>
      <p className="tiny muted">
        Na tela do Google, escolha a conta (ou o canal) e deixe marcada a permissão do YouTube. Se aparecer “O Google não verificou este app”,
        toque em <b>Avançado</b> e depois em <b>Acessar</b> — o app é da igreja e só usa a permissão para criar as lives.
      </p>
    </div>
  );
}

function NoChannel({ email, onChecked }: { email: string | null; onChecked: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="card card-pad stack">
      <div style={{ fontWeight: 700, fontSize: 17 }}>Falta criar o canal no YouTube</div>
      <p className="small" style={{ color: 'var(--ink-2)' }}>
        A conta {email ? <b>{email}</b> : 'conectada'} ainda não tem canal. É rápido: abra o YouTube com essa conta, toque na sua foto →{' '}
        <b>Criar um canal</b>. Depois volte aqui.
      </p>
      <a className="btn btn-secondary" href="https://www.youtube.com/create_channel" target="_blank" rel="noopener noreferrer">
        <ExternalLink /> Criar canal no YouTube
      </a>
      <Button
        loading={busy}
        icon={<RefreshCw />}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ channel: unknown }>('/live/youtube/canal', { method: 'POST' });
            if (!r.channel) toast('Ainda não encontrei o canal. Pode levar um minutinho.', 'info');
            await onChecked();
          } catch (e) {
            toastError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Já criei, conferir
      </Button>
      <DisconnectLink onDone={onChecked} />
    </div>
  );
}

function DisconnectLink({ onDone }: { onDone: () => Promise<void> }) {
  return (
    <button
      className="link-btn small"
      style={{ alignSelf: 'center', color: 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      onClick={async () => {
        if (!(await confirmDialog({ title: 'Desconectar o YouTube?', text: 'O app apaga a permissão. Para fazer live de novo, é só conectar.', confirmLabel: 'Desconectar' })))
          return;
        try {
          await api('/live/youtube/desconectar', { method: 'POST' });
          toast('YouTube desconectado.', 'ok');
          await onDone();
        } catch (e) {
          toastError(e);
        }
      }}
    >
      <Unplug size={14} /> Usar outra conta / desconectar
    </button>
  );
}

function ProblemBox({ p, onRetry }: { p: Problem; onRetry: () => void }) {
  if (p.code === 'live_desativada')
    return (
      <div className="card card-pad stack" style={{ borderColor: 'var(--warn)' }}>
        <div className="row" style={{ fontWeight: 700 }}>
          <TriangleAlert color="var(--warn)" /> Ative a live no seu YouTube (só uma vez)
        </div>
        <ol className="steps small">
          <li>
            No navegador, entre em{' '}
            <a href="https://www.youtube.com/verify" target="_blank" rel="noopener noreferrer">
              youtube.com/verify
            </a>{' '}
            com a mesma conta e confirme o seu telefone.
          </li>
          <li>
            Abra o{' '}
            <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">
              YouTube Studio
            </a>{' '}
            → <b>Criar</b> → <b>Transmitir ao vivo</b> e aceite a ativação.
          </li>
          <li>Na primeira vez o YouTube libera em até 24 horas. Depois disso, é na hora.</li>
        </ol>
        <p className="tiny muted">
          Pela câmera do app não precisa de 50 inscritos: essa regra é só do botão “Transmitir” do aplicativo do YouTube.
        </p>
        <Button variant="secondary" icon={<RefreshCw />} onClick={onRetry}>
          Já ativei, tentar de novo
        </Button>
      </div>
    );
  if (p.code === 'reconectar') return <ConnectCard again />;
  return (
    <div className="alert danger">
      <TriangleAlert />
      <div className="stack" style={{ gap: 6 }}>
        <span>{p.message}</span>
        {p.code === 'live_bloqueada' && (
          <a href="https://studio.youtube.com/" target="_blank" rel="noopener noreferrer">
            Abrir o YouTube Studio
          </a>
        )}
      </div>
    </div>
  );
}

function ChannelChip({ acc, onChanged }: { acc: Account; onChanged: () => Promise<void> }) {
  return (
    <div className="card card-pad stack" style={{ gap: 8 }}>
      <div className="row">
        {acc.channel?.thumb ? (
          <img
            src={acc.channel.thumb}
            alt=""
            width={38}
            height={38}
            className="channel-thumb"
            referrerPolicy="no-referrer"
            onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
          />
        ) : (
          <Radio />
        )}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="tiny muted">A live sai no canal</div>
          <div className="ellipsis" style={{ fontWeight: 650 }}>
            {acc.channel?.title}
          </div>
        </div>
      </div>
      {!acc.session && <DisconnectLink onDone={onChanged} />}
    </div>
  );
}

function fmtElapsed(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h ? `${h}:` : ''}${m}:${ss}`;
}

function Ready({ acc, reload }: { acc: Account; reload: () => Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const casterRef = useRef<LiveCaster | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const [support, setSupport] = useState<CastSupport | null>(null);
  const [session, setSession] = useState<SessionView | null>(acc.session);
  const [mode, setMode] = useState<'app' | 'externo'>(acc.session?.mode ?? 'app');
  const [title, setTitle] = useState(acc.session?.title ?? `Culto de ${WEEKDAYS[new Date().getDay()]}`);
  const [privacy, setPrivacy] = useState<'public' | 'unlisted'>(acc.session?.privacy ?? 'public');
  const [quality, setQuality] = useState<Quality>('720');
  const [music, setMusic] = useState(true);
  const [notifyAll, setNotifyAll] = useState(acc.session?.notify ?? true);
  const [facing, setFacing] = useState<Facing>('environment');
  const [micOn, setMicOn] = useState(true);
  const [phase, setPhase] = useState<CastPhase>('parado');
  const [phaseMsg, setPhaseMsg] = useState('');
  const [stats, setStats] = useState<CastStats | null>(null);
  const [yt, setYt] = useState<{ youtube?: string; stream?: string | null; health?: string | null } | null>(null);
  const [camError, setCamError] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendingSince, setSendingSince] = useState(0);
  const [portrait, setPortrait] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [live] = useLiveState();
  const running = phase !== 'parado';
  const onAir = session?.status === 'no_ar';

  useEffect(() => {
    let alive = true;
    void castSupport().then((s) => {
      if (!alive) return;
      setSupport(s);
      if (!s.ok && !acc.session) setMode('externo');
    });
    return () => {
      alive = false;
    };
  }, [acc.session]);

  // O transmissor vive enquanto a tela estiver aberta.
  useEffect(() => {
    const c = new LiveCaster(videoRef.current!);
    c.onPhase = (p, msg) => {
      setPhase(p);
      setPhaseMsg(msg ?? '');
      if (p === 'enviando') setSendingSince((t) => t || Date.now());
    };
    c.onStats = (s) => {
      setStats(s);
      setPortrait(c.isPortrait());
    };
    casterRef.current = c;
    return () => {
      void c.stop();
      c.release();
      casterRef.current = null;
    };
  }, []);

  // Câmera (prévia) no modo "câmera do app".
  useEffect(() => {
    const c = casterRef.current;
    if (!c || !support?.ok) return;
    if (mode !== 'app') {
      if (!c.isRunning) c.release();
      return;
    }
    let alive = true;
    c.openCamera({ facing, music, quality })
      .then(() => alive && setCamError(''))
      .catch((e) => alive && setCamError(cameraError(e)));
    return () => {
      alive = false;
    };
  }, [mode, support, facing, music, quality]);

  useEffect(() => {
    casterRef.current?.setMicOn(micOn);
  }, [micOn]);

  // Relógio da tela (tempo no ar).
  useEffect(() => {
    if (!running && !onAir) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, onAir]);

  // Tela acesa e aviso ao fechar a página enquanto transmite.
  useEffect(() => {
    if (!running) return;
    const lock = async () => {
      try {
        wakeRef.current = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* sem bloqueio de tela */
      }
    };
    void lock();
    const onVis = () => document.visibilityState === 'visible' && void lock();
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', warn);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', warn);
      void wakeRef.current?.release().catch(() => undefined);
      wakeRef.current = null;
    };
  }, [running]);

  const ended = useCallback(
    async (msg: string) => {
      await casterRef.current?.stop();
      setSession(null);
      setSendingSince(0);
      setYt(null);
      void refreshLive();
      toast(msg, 'info');
      await reload();
    },
    [reload],
  );

  // Conferir no YouTube: a cada 4 s até entrar no ar; depois, a cada 2 minutos (saúde do sinal e se a live terminou lá).
  const sessionId = session?.id;
  const sessionStatus = session?.status;
  const sessionMode = session?.mode;
  useEffect(() => {
    if (!sessionId || sessionStatus === 'encerrada') return;
    const waitingApp = sessionMode === 'app' && sessionStatus === 'preparada' && phase !== 'enviando';
    if (waitingApp) return;
    let alive = true;
    const check = async () => {
      try {
        const forcar = sessionStatus === 'preparada' && sendingSince > 0 && Date.now() - sendingSince > 25_000;
        const r = await api<{ status: SessionView['status']; youtube?: string; stream?: string | null; health?: string | null }>(
          '/live/youtube/conferir',
          { body: { sessao: sessionId, forcar } },
        );
        if (!alive) return;
        setYt(r);
        if (r.status === 'encerrada') {
          await ended('A live foi encerrada no YouTube.');
          return;
        }
        if (r.status === 'no_ar' && sessionStatus !== 'no_ar') {
          setSession((s) => (s ? { ...s, status: 'no_ar' } : s));
          toast('Você está ao vivo! A live já aparece no app para todos.', 'ok');
          void refreshLive();
          void helpDrain();
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'reconectar') setProblem({ code: e.code, message: e.message });
      }
    };
    void check();
    const t = setInterval(check, sessionStatus === 'no_ar' ? 120_000 : sessionMode === 'externo' ? 5_000 : 4_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [sessionId, sessionStatus, sessionMode, phase, sendingSince, ended]);

  // Se a live do app foi encerrada por outra pessoa (ou pelo app), para de transmitir.
  // (Só depois de ver a live ativa no app pelo menos uma vez, para não confundir com o dado ainda não atualizado.)
  const liveActive = !!live?.active;
  const seenActive = useRef(false);
  useEffect(() => {
    if (!onAir) {
      seenActive.current = false;
      return;
    }
    if (liveActive) seenActive.current = true;
    else if (seenActive.current) {
      seenActive.current = false;
      void ended('A live foi encerrada.');
    }
  }, [onAir, liveActive, ended]);

  const startApp = async () => {
    const c = casterRef.current;
    if (!c) return;
    c.primeAudio(); // precisa ser no toque (iPhone)
    setBusy(true);
    setProblem(null);
    try {
      let s = session;
      if (!s || s.status === 'encerrada' || s.mode !== 'app') {
        const r = await api<{ session: SessionView }>('/live/youtube/preparar', { body: { title, privacy, mode: 'app', notify: notifyAll } });
        s = r.session;
        setSession(s);
      }
      if (!s.rtmp) throw new Error('O YouTube não devolveu a chave de transmissão. Tente de novo.');
      setSendingSince(0);
      await c.start({ wsUrl: wsUrl(s.id), url: s.rtmp.url, key: s.rtmp.key });
    } catch (e) {
      setProblem({ code: e instanceof ApiError ? e.code : undefined, message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const prepareExternal = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await api<{ session: SessionView }>('/live/youtube/preparar', { body: { title, privacy, mode: 'externo', notify: notifyAll } });
      setSession(r.session);
    } catch (e) {
      setProblem({ code: e instanceof ApiError ? e.code : undefined, message: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    const wasLive = session?.status === 'no_ar';
    if (
      !(await confirmDialog({
        title: wasLive ? 'Encerrar a live?' : 'Cancelar esta live?',
        text: wasLive ? 'A transmissão termina no YouTube e sai do app para todos.' : 'A live ainda não começou; ela será apagada do YouTube.',
        confirmLabel: wasLive ? 'Encerrar' : 'Cancelar live',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    await casterRef.current?.stop();
    try {
      if (session) await api('/live/youtube/cancelar', { body: { sessao: session.id } });
      toast(wasLive ? 'Live encerrada.' : 'Live cancelada.', 'ok');
    } catch (e) {
      toastError(e);
    }
    setSession(null);
    setSendingSince(0);
    setYt(null);
    void refreshLive();
    await reload();
    setBusy(false);
  };

  const elapsed = sendingSince ? now - sendingSince : 0;
  const stuck = session?.status === 'preparada' && phase === 'enviando' && elapsed > 45_000;
  const appOk = support?.ok !== false;
  const canStart = !acc.busy && !busy;

  let badge: ReactNode = <span className="badge">Prévia</span>;
  if (onAir && (phase === 'enviando' || mode === 'externo')) badge = <span className="badge live">AO VIVO</span>;
  else if (phase === 'reconectando') badge = <span className="badge warn">Reconectando…</span>;
  else if (phase === 'conectando') badge = <span className="badge">Conectando…</span>;
  else if (phase === 'enviando') badge = <span className="badge gold">Esperando o YouTube…</span>;
  else if (phase === 'falhou') badge = <span className="badge danger">Parou</span>;

  return (
    <div className="stack">
      <ChannelChip acc={acc} onChanged={reload} />
      {acc.busy && !session && (
        <div className="alert warn">
          <TriangleAlert />
          <span>Já tem uma live no ar no app. Para começar outra, ela precisa ser encerrada primeiro.</span>
        </div>
      )}
      {problem && <ProblemBox p={problem} onRetry={() => void (mode === 'app' ? startApp() : prepareExternal())} />}

      {!session && (
        <div className="card card-pad stack">
          <div className="field">
            <span className="field-label">Como vai transmitir?</span>
            <Seg
              value={mode}
              onChange={(m) => setMode(m)}
              options={[
                { value: 'app', label: 'Câmera do app' },
                { value: 'externo', label: 'Outro app (Larix)' },
              ]}
            />
          </div>
          {mode === 'app' && support && !support.ok && <div className="alert warn">{support.reason}</div>}
        </div>
      )}

      {/* Um único <video> fica sempre montado (o transmissor desenha a partir dele); some quando não é usado. */}
      <div className="stack" style={mode === 'app' && appOk ? undefined : { display: 'none' }}>
        <>
          <div className={`broadcast-stage ${facing === 'user' ? 'mirror' : ''}`}>
            <video ref={videoRef} autoPlay playsInline muted />
            <div className="overlay">
              {badge}
              {running && (
                <span className="badge" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
                  {sendingSince ? fmtElapsed(elapsed) : '00:00'}
                  {stats ? ` · ${stats.kbps} kbps` : ''}
                </span>
              )}
            </div>
            {portrait && <div className="stage-hint">Vire o celular de lado para a imagem ocupar a tela toda.</div>}
          </div>
          {camError && <div className="alert danger">{camError}</div>}
          <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" icon={<SwitchCamera />} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
              Trocar câmera
            </Button>
            <Button variant={micOn ? 'secondary' : 'danger'} size="sm" icon={micOn ? <Mic /> : <MicOff />} onClick={() => setMicOn((m) => !m)}>
              {micOn ? 'Microfone ligado' : 'Microfone mudo'}
            </Button>
          </div>
        </>
      </div>

      {/* Situação durante a live pela câmera */}
      {mode === 'app' && running && (
        <div className="card card-pad stack">
          {phase === 'conectando' && <div className="small">Ligando a transmissão ao YouTube…</div>}
          {phase === 'enviando' && !onAir && (
            <div className="small">
              O vídeo já está indo para o YouTube. Em alguns segundos a live entra no ar e aparece no app para todos
              {session?.notify ? ' (com notificação)' : ''}.
            </div>
          )}
          {stuck && (
            <div className="alert warn">
              <TriangleAlert />
              <span>
                O YouTube ainda não colocou a live no ar. Confira se a internet está boa (de preferência Wi-Fi). Situação no YouTube:{' '}
                {yt?.youtube ?? '…'} / sinal {yt?.stream ?? '…'}.
              </span>
            </div>
          )}
          {onAir && phase === 'enviando' && (
            <div className="alert ok">
              <CircleCheck />
              <span>
                Ao vivo no YouTube e no app.{' '}
                <a href={session!.watch_url} target="_blank" rel="noopener noreferrer">
                  Ver no YouTube
                </a>
              </span>
            </div>
          )}
          {phase === 'reconectando' && (
            <div className="alert warn">
              <RefreshCw className="spin" />
              <span>A internet oscilou — reconectando sozinho na mesma live. {phaseMsg}</span>
            </div>
          )}
          {phase === 'falhou' && (
            <div className="alert danger">
              <TriangleAlert />
              <div className="stack" style={{ gap: 8 }}>
                <span>{phaseMsg || 'A transmissão parou.'}</span>
                <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => casterRef.current?.retry()}>
                  Tentar de novo
                </Button>
              </div>
            </div>
          )}
          {stats && stats.nivel > 0 && phase === 'enviando' && (
            <div className="tiny muted">A internet está fraca: a qualidade foi reduzida para a live não travar.</div>
          )}
          {onAir && yt?.health === 'bad' && <div className="tiny" style={{ color: 'var(--warn)' }}>O YouTube diz que o sinal está ruim. Tente chegar mais perto do Wi-Fi.</div>}
          <Button variant="danger" icon={<Square />} block loading={busy} onClick={() => void finish()}>
            {onAir ? 'Encerrar live' : 'Cancelar'}
          </Button>
          <p className="tiny muted">Não saia do app nem bloqueie a tela durante a live. Deixe o celular carregando e, se puder, no Wi-Fi.</p>
        </div>
      )}

      {/* Live em andamento desta pessoa, mas a tela foi aberta de novo (ex.: o app fechou) */}
      {mode === 'app' && appOk && !running && session && (
        <div className="card card-pad stack">
          <div style={{ fontWeight: 650 }}>{session.status === 'no_ar' ? 'Sua live está no ar' : 'Sua live está pronta para começar'}</div>
          <p className="small muted">“{session.title}”. Toque para voltar a mandar a câmera para a mesma live.</p>
          <Button variant="live" icon={<Radio />} block loading={busy} disabled={!!camError} onClick={() => void startApp()}>
            {session.status === 'no_ar' ? 'Retomar transmissão' : 'Começar transmissão'}
          </Button>
          <Button variant="ghost" loading={busy} onClick={() => void finish()}>
            {session.status === 'no_ar' ? 'Encerrar live' : 'Cancelar esta live'}
          </Button>
        </div>
      )}

      {/* Formulário para começar */}
      {!session && (mode === 'externo' || appOk) && (
        <div className="card card-pad stack">
          <TextField label="Título da live" value={title} onChange={setTitle} maxLength={100} />
          <div className="field">
            <span className="field-label">Quem pode ver no YouTube</span>
            <Seg
              value={privacy}
              onChange={setPrivacy}
              options={[
                { value: 'public', label: 'Público' },
                { value: 'unlisted', label: 'Só com o link' },
              ]}
            />
          </div>
          {mode === 'app' && (
            <>
              <div className="field">
                <span className="field-label">Qualidade</span>
                <Seg
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { value: '720', label: QUALITIES['720'].label },
                    { value: '480', label: QUALITIES['480'].label },
                  ]}
                />
              </div>
              <Toggle label="Modo música" hint="Desliga a redução de ruído do celular para o louvor soar natural." checked={music} onChange={setMusic} />
            </>
          )}
          <Toggle label="Avisar todo mundo quando entrar no ar" hint="Notificação no celular de quem ativou." checked={notifyAll} onChange={setNotifyAll} />
          {mode === 'app' ? (
            <Button variant="live" icon={<Radio />} block loading={busy} disabled={!canStart || !!camError} onClick={() => void startApp()}>
              Começar a live
            </Button>
          ) : (
            <Button variant="live" icon={<KeyRound />} block loading={busy} disabled={!canStart} onClick={() => void prepareExternal()}>
              Criar a live e mostrar a chave
            </Button>
          )}
          <p className="tiny muted">
            {mode === 'app'
              ? 'Dicas: celular deitado num tripé, ligado no carregador e no Wi-Fi. A tela fica acesa enquanto transmite.'
              : 'O app cria a live no seu canal e mostra a chave para colar no Larix Broadcaster ou no Streamlabs (grátis). Quando o vídeo chegar ao YouTube, a live aparece aqui no app.'}
          </p>
        </div>
      )}

      {mode === 'externo' && session && <ExternalPanel session={session} quality={quality} busy={busy} yt={yt} onFinish={() => void finish()} />}
    </div>
  );
}

function ExternalPanel({
  session,
  quality,
  busy,
  yt,
  onFinish,
}: {
  session: SessionView;
  quality: Quality;
  busy: boolean;
  yt: { youtube?: string; stream?: string | null } | null;
  onFinish: () => void;
}) {
  const [show, setShow] = useState(false);
  const onAir = session.status === 'no_ar';
  if (!session.rtmp) return <div className="alert danger">A chave de transmissão não veio do YouTube. Cancele e crie a live de novo.</div>;
  const full = `${session.rtmp.url}/${session.rtmp.key}`;
  return (
    <div className="card card-pad stack">
      {onAir ? (
        <div className="alert ok">
          <CircleCheck />
          <span>
            Ao vivo! A live já aparece no app para todos.{' '}
            <a href={session.watch_url} target="_blank" rel="noopener noreferrer">
              Ver no YouTube
            </a>
          </span>
        </div>
      ) : (
        <div className="alert">
          <Smartphone />
          <span>
            A live “{session.title}” foi criada no seu canal. Agora comece a transmitir pelo outro app — quando o vídeo chegar ao YouTube, ela aparece
            aqui no app {session.notify ? 'e todo mundo recebe a notificação' : ''}.
          </span>
        </div>
      )}
      <div className="field">
        <span className="field-label">Larix Broadcaster (Android e iPhone, grátis)</span>
        <a className="btn btn-primary btn-block" href={larixLink(full, quality)}>
          <ExternalLink /> Abrir no Larix já configurado
        </a>
        <div className="hint">Se o botão não abrir, instale o Larix Broadcaster na loja do celular e toque de novo.</div>
      </div>
      <div className="field">
        <span className="field-label">Endereço completo (Larix e outros)</span>
        <div className="keybox">{show ? full : `${session.rtmp.url}/••••••••`}</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <CopyButton text={full} label="Copiar endereço completo" />
          <Button variant="ghost" size="sm" icon={show ? <EyeOff /> : <Eye />} onClick={() => setShow((s) => !s)}>
            {show ? 'Esconder' : 'Mostrar'}
          </Button>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Streamlabs e outros (servidor e chave separados)</span>
        <div className="keybox">{session.rtmp.url}</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <CopyButton text={session.rtmp.url} label="Copiar servidor" />
          <CopyButton text={session.rtmp.key} label="Copiar chave" />
        </div>
        <div className="hint">A chave é como uma senha da sua live: não mande para ninguém.</div>
      </div>
      {!onAir && (
        <div className="tiny muted">
          Situação no YouTube: {yt?.youtube ?? 'aguardando'} · sinal: {yt?.stream === 'active' ? 'chegando' : 'ainda não chegou'}. O app confere sozinho a
          cada poucos segundos.
        </div>
      )}
      <Button variant={onAir ? 'danger' : 'ghost'} icon={onAir ? <Square /> : undefined} block loading={busy} onClick={onFinish}>
        {onAir ? 'Encerrar live' : 'Cancelar esta live'}
      </Button>
      <Link className="tiny muted" to="/ao-vivo" style={{ alignSelf: 'center' }}>
        Voltar para Ao vivo
      </Link>
    </div>
  );
}
