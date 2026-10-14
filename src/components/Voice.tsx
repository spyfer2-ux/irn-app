/** Áudio estilo WhatsApp: gravar pelo microfone e tocar como "mensagem de voz". */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Mic, Pause, Play, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { toast, toastError } from './ui';
import './Voice.css';

const MAX_SECONDS = 30 * 60;

export function fmtClock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Formato que o aparelho sabe gravar — de preferência MP4/AAC, que toca em qualquer celular (inclusive iPhone). */
function pickMime(): string {
  const list = ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (typeof MediaRecorder === 'undefined') return '';
  return list.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '';
}

export function recordingSupported() {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

async function uploadVoice(blob: Blob, duration: number, access: 'public' | 'members'): Promise<string> {
  const mime = (blob.type || 'audio/webm').split(';')[0];
  const qs = new URLSearchParams({ access, d: duration.toFixed(1) });
  const r = await api<{ id: string }>(`/media/voice?${qs}`, { method: 'POST', raw: blob, contentType: mime });
  return r.id;
}

/** Botão de gravar áudio (como no WhatsApp). Ao terminar, envia e devolve o id do arquivo. */
export function VoiceRecorder({
  audioId,
  audioUrl,
  duration,
  onChange,
  access,
}: {
  audioId: string | null;
  audioUrl: string | null;
  duration: number | null;
  onChange: (v: { id: string | null; url: string | null; duration: number | null }) => void;
  access: 'public' | 'members';
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'uploading'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0.08));
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  const cleanup = () => {
    if (timer.current) clearInterval(timer.current);
    if (raf.current) cancelAnimationFrame(raf.current);
    timer.current = raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => undefined);
    ctx.current = null;
  };
  useEffect(() => () => {
    cancelled.current = true;
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
    cleanup();
  }, []);

  const start = async () => {
    if (!recordingSupported()) return toast('Este aparelho não grava áudio pelo navegador. Tente pelo celular, no Chrome ou Safari atualizado.', 'error');
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return toast('Libere o microfone para o app (no cadeado ao lado do endereço) e tente de novo.', 'error');
    }
    stream.current = s;
    const mime = pickMime();
    const r = new MediaRecorder(s, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
    rec.current = r;
    chunks.current = [];
    cancelled.current = false;
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = async () => {
      const secs = (Date.now() - started.current) / 1000;
      cleanup();
      if (cancelled.current) {
        setState('idle');
        return;
      }
      const blob = new Blob(chunks.current, { type: r.mimeType || mime || 'audio/webm' });
      if (secs < 1 || !blob.size) {
        setState('idle');
        return toast('Áudio muito curto. Toque no microfone e fale.', 'info');
      }
      setState('uploading');
      try {
        const id = await uploadVoice(blob, secs, access);
        onChange({ id, url: URL.createObjectURL(blob), duration: secs });
        setState('idle');
      } catch (e) {
        toastError(e);
        setState('idle');
      }
    };
    // Nível do microfone, para as barrinhas se mexerem enquanto grava.
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick);
        if (t - last < 80) return;
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const lvl = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        setLevels((l) => [...l.slice(1), Math.max(0.08, lvl)]);
      };
      raf.current = requestAnimationFrame(tick);
    } catch {
      /* sem barrinhas */
    }
    started.current = Date.now();
    setElapsed(0);
    setLevels(Array(32).fill(0.08));
    r.start(1000);
    setState('recording');
    timer.current = window.setInterval(() => {
      const e = (Date.now() - started.current) / 1000;
      setElapsed(e);
      if (e >= MAX_SECONDS) stop();
    }, 250);
  };

  const stop = () => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop();
  };
  const cancel = () => {
    cancelled.current = true;
    stop();
  };

  if (state === 'recording')
    return (
      <div className="voice-rec recording" role="group" aria-label="Gravando áudio">
        <button type="button" className="voice-icon-btn" aria-label="Cancelar gravação" onClick={cancel}>
          <Trash2 />
        </button>
        <span className="voice-dot" aria-hidden />
        <span className="voice-time">{fmtClock(elapsed)}</span>
        <div className="voice-levels" aria-hidden>
          {levels.map((l, i) => (
            <span key={i} style={{ height: `${Math.round(l * 100)}%` }} />
          ))}
        </div>
        <button type="button" className="voice-main-btn send" aria-label="Terminar e salvar o áudio" onClick={stop}>
          <Check />
        </button>
      </div>
    );

  if (state === 'uploading')
    return (
      <div className="voice-rec">
        <Loader2 className="spin" />
        <span className="grow small">Enviando o áudio…</span>
      </div>
    );

  if (audioId)
    return (
      <div className="stack" style={{ gap: 6 }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="grow">
            <VoiceNote src={audioUrl ?? `/api/media/${audioId}`} duration={duration} />
          </div>
          <button
            type="button"
            className="voice-icon-btn"
            aria-label="Apagar áudio"
            title="Apagar e gravar de novo"
            onClick={() => onChange({ id: null, url: null, duration: null })}
          >
            <Trash2 />
          </button>
        </div>
        <div className="tiny muted">Para trocar, apague e grave de novo.</div>
      </div>
    );

  return (
    <div className="voice-rec">
      <div className="grow">
        <div style={{ fontWeight: 620 }}>Gravar áudio</div>
        <div className="tiny muted">Toque no microfone, fale, e toque no ✓ para terminar.</div>
      </div>
      <button type="button" className="voice-main-btn" aria-label="Gravar áudio" onClick={() => void start()}>
        <Mic />
      </button>
    </div>
  );
}

const SPEEDS = [1, 1.5, 2];

/** Player de "mensagem de voz": play/pausa, barra para avançar e velocidade 1x/1,5x/2x. */
export function VoiceNote({ src, duration, label }: { src: string; duration?: number | null; label?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [total, setTotal] = useState(duration ?? 0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) void a.play().catch(() => toast('Não consegui tocar o áudio.', 'error'));
    else a.pause();
  };
  const seek = (e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
    const a = ref.current;
    if (!a || !total) return;
    if ('key' in e) {
      if (e.key === 'ArrowRight') a.currentTime = Math.min(total, a.currentTime + 5);
      if (e.key === 'ArrowLeft') a.currentTime = Math.max(0, a.currentTime - 5);
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(total - 0.1, ((e.clientX - r.left) / r.width) * total));
  };
  const pct = total ? Math.min(100, (time / total) * 100) : 0;

  return (
    <div className="voice-note">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setTime(0);
        }}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
          e.currentTarget.playbackRate = speed;
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
      />
      <button type="button" className="voice-main-btn" aria-label={playing ? 'Pausar' : label ? `Ouvir ${label}` : 'Ouvir'} onClick={toggle}>
        {playing ? <Pause /> : <Play style={{ marginLeft: 3 }} />}
      </button>
      <div className="grow" style={{ minWidth: 0 }}>
        <div
          className="voice-bar"
          role="slider"
          tabIndex={0}
          aria-label="Posição do áudio"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(time)}
          onClick={seek}
          onKeyDown={seek}
        >
          <span style={{ width: `${pct}%` }} />
          <i style={{ left: `${pct}%` }} />
        </div>
        <div className="voice-meta">
          <span>{playing || time > 0 ? fmtClock(time) : fmtClock(total)}</span>
          {label && <span className="ellipsis">{label}</span>}
        </div>
      </div>
      <button type="button" className="voice-speed" aria-label="Velocidade" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}>
        {String(speed).replace('.', ',')}x
      </button>
    </div>
  );
}
