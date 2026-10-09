import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, MicOff, Radio, RefreshCw, Square } from 'lucide-react';
import { api, errMsg } from '../lib/api';
import { helpDrain } from '../lib/push';
import { Broadcaster } from '../lib/webrtc';
import { WEEKDAYS } from '../lib/format';
import { Button, confirmDialog, RoleOnly, Seg, TextField, Toggle, toast } from '../components/ui';
import { refreshLive } from '../components/Layout';

type Phase = 'preparando' | 'pronto' | 'conectando' | 'aovivo' | 'erro';

function constraints(facing: 'user' | 'environment', quality: '720' | '480', music: boolean): MediaStreamConstraints {
  const h = quality === '720' ? 720 : 480;
  return {
    video: { facingMode: facing, width: { ideal: (h * 16) / 9 }, height: { ideal: h }, frameRate: { ideal: 30, max: 30 } },
    audio: music
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
}

function BroadcastInner() {
  const navigate = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const caster = useRef<Broadcaster | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);
  const [phase, setPhase] = useState<Phase>('preparando');
  const [error, setError] = useState('');
  const [facing, setFacing] = useState<'user' | 'environment'>('environment');
  const [quality, setQuality] = useState<'720' | '480'>('720');
  const [music, setMusic] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [title, setTitle] = useState(`Culto de ${WEEKDAYS[new Date().getDay()]}`);
  const [notify, setNotify] = useState(true);
  const [startedAt, setStartedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const [kbps, setKbps] = useState<number | null>(null);

  const openCamera = async () => {
    setError('');
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints(facing, quality, music));
      const old = stream.current;
      stream.current = s;
      if (video.current) video.current.srcObject = s;
      s.getAudioTracks().forEach((t) => (t.enabled = micOn));
      if (caster.current) {
        for (const t of s.getTracks()) await caster.current.replaceTrack(t);
      }
      old?.getTracks().forEach((t) => t.stop());
      setPhase((p) => (p === 'preparando' || p === 'erro' ? 'pronto' : p));
    } catch (e) {
      setPhase('erro');
      setError(
        (e as Error).name === 'NotAllowedError'
          ? 'O navegador não liberou a câmera e o microfone. Toque no cadeado da barra de endereço e permita.'
          : `Não consegui abrir a câmera: ${errMsg(e)}`,
      );
    }
  };

  useEffect(() => {
    void openCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, quality, music]);

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      void caster.current?.stop();
      void wake.current?.release().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    stream.current?.getAudioTracks().forEach((t) => (t.enabled = micOn));
  }, [micOn]);

  useEffect(() => {
    if (phase !== 'aovivo') return;
    const t = setInterval(async () => {
      setTick((x) => x + 1);
      const st = await caster.current?.stats();
      if (st) setKbps(st.kbps);
    }, 1000);
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', warn);
    };
  }, [phase]);

  const start = async () => {
    if (!stream.current) return;
    setPhase('conectando');
    setError('');
    try {
      const { whip_url } = await api<{ whip_url: string }>('/live/transmitir');
      const b = new Broadcaster();
      caster.current = b;
      let announced = false;
      b.onState = async (s) => {
        if (s === 'connected' && !announced) {
          announced = true;
          try {
            await api('/live/iniciar', { method: 'POST', body: { source: 'app', title, notify, replace: true } });
            setStartedAt(Date.now());
            setPhase('aovivo');
            void refreshLive();
            toast('Você está ao vivo!', 'ok');
            if (notify) void helpDrain();
          } catch (e) {
            setError(errMsg(e));
          }
        }
        if (s === 'failed') {
          setPhase('erro');
          setError('A conexão com o servidor de transmissão caiu. Verifique a internet e tente de novo.');
        }
      };
      await b.start(stream.current, whip_url);
      try {
        wake.current = await navigator.wakeLock?.request('screen');
      } catch {
        /* sem bloqueio de tela */
      }
    } catch (e) {
      await caster.current?.stop();
      caster.current = null;
      setPhase('erro');
      setError(`Não consegui iniciar a transmissão: ${errMsg(e)}`);
    }
  };

  const stop = async () => {
    if (!(await confirmDialog({ title: 'Encerrar a transmissão?', confirmLabel: 'Encerrar', danger: true }))) return;
    await caster.current?.stop();
    caster.current = null;
    await api('/live/encerrar', { method: 'POST' }).catch(() => undefined);
    void wake.current?.release().catch(() => undefined);
    void refreshLive();
    setPhase('pronto');
    toast('Transmissão encerrada.', 'ok');
  };

  const elapsed = startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
  void tick;
  const hh = Math.floor(elapsed / 3600);
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  return (
    <div className="stack">
      <div className="broadcast-stage">
        <video ref={video} autoPlay playsInline muted style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
        <div className="overlay">
          {phase === 'aovivo' ? <span className="badge live">AO VIVO</span> : <span className="badge">{phase === 'conectando' ? 'Conectando…' : 'Prévia'}</span>}
          {phase === 'aovivo' && (
            <span className="badge" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>
              {hh ? `${hh}:` : ''}
              {mm}:{ss}
              {kbps !== null ? ` · ${kbps} kbps` : ''}
            </span>
          )}
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}

      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
          Trocar câmera
        </Button>
        <Button variant={micOn ? 'secondary' : 'danger'} size="sm" icon={micOn ? <Mic /> : <MicOff />} onClick={() => setMicOn((m) => !m)}>
          {micOn ? 'Microfone ligado' : 'Microfone mudo'}
        </Button>
      </div>

      {phase !== 'aovivo' ? (
        <div className="card card-pad stack">
          <TextField label="Título da live" value={title} onChange={setTitle} maxLength={120} />
          <div className="field">
            <span className="field-label">Qualidade</span>
            <Seg
              value={quality}
              onChange={setQuality}
              options={[
                { value: '720', label: 'Alta (720p)' },
                { value: '480', label: 'Econômica (480p)' },
              ]}
            />
          </div>
          <Toggle label="Modo música" hint="Desliga a redução de ruído do celular para o louvor soar natural." checked={music} onChange={setMusic} />
          <Toggle label="Avisar todo mundo quando entrar no ar" checked={notify} onChange={setNotify} />
          <Button variant="live" icon={<Radio />} block loading={phase === 'conectando'} disabled={phase === 'preparando'} onClick={() => void start()}>
            Iniciar transmissão
          </Button>
          <p className="tiny muted">Dicas: use Wi-Fi, deixe o celular na horizontal num tripé e conectado ao carregador. A tela fica acesa enquanto transmite.</p>
        </div>
      ) : (
        <Button variant="danger" icon={<Square />} block onClick={() => void stop()}>
          Encerrar transmissão
        </Button>
      )}

      <Button variant="ghost" icon={<ArrowLeft />} onClick={() => navigate('/ao-vivo')}>
        Voltar para Ao vivo
      </Button>
    </div>
  );
}

export default function Broadcast() {
  return (
    <main className="wrap page" style={{ paddingTop: 'calc(var(--safe-t) + 14px)' }}>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <h1 style={{ fontSize: 22 }}>Transmitir</h1>
        <Link to="/ao-vivo" className="btn btn-ghost btn-sm">
          Fechar
        </Link>
      </div>
      <RoleOnly need="media">
        {typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices ? (
          <div className="alert warn">Este navegador não consegue transmitir. Use o Chrome (Android) ou o Safari (iPhone) atualizado.</div>
        ) : (
          <BroadcastInner />
        )}
      </RoleOnly>
    </main>
  );
}
