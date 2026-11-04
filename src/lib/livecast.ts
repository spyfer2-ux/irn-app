/**
 * Live pela câmera do celular, de dentro do app, para o canal do YouTube da própria pessoa.
 *
 * Câmera e microfone → o celular codifica (vídeo H.264 pelo acelerador do aparelho e áudio AAC, via WebCodecs) →
 * protocolo RTMP (./rtmp.ts) → WebSocket até o servidor do app na Cloudflare → servidor de entrada do YouTube.
 * Se a internet oscilar, a qualidade baixa sozinha; se cair, reconecta sozinho na mesma live.
 */
import {
  aacAudioPacket,
  aacConfig,
  aacSequenceHeader,
  avcSequenceHeader,
  avcVideoPacket,
  buildAvcC,
  concatBytes,
  isAnnexB,
  nalusToAvcc,
  RtmpError,
  RtmpPublisher,
  splitAnnexB,
  stripAdts,
  type RtmpTransport,
} from './rtmp';

export type Quality = '720' | '480';
export const QUALITIES: Record<Quality, { w: number; h: number; kbps: number; label: string }> = {
  '720': { w: 1280, h: 720, kbps: 2500, label: 'Alta (720p)' },
  '480': { w: 854, h: 480, kbps: 1200, label: 'Econômica (480p)' },
};
const AUDIO_KBPS = 128;
const FPS = 30;
const KEYFRAME_US = 2_000_000;
/** Degraus da qualidade quando a internet não dá conta (fração da taxa escolhida). */
const LEVELS = [1, 0.7, 0.5, 0.35];
const AVC_CODECS = ['avc1.640028', 'avc1.4d4028', 'avc1.42e028', 'avc1.42001f'];

export type Facing = 'user' | 'environment';
export type CastPhase = 'parado' | 'conectando' | 'enviando' | 'reconectando' | 'falhou';
export interface CastStats {
  /** Taxa enviada agora (kbps). */
  kbps: number;
  fps: number;
  /** Segundos de vídeo esperando para sair (internet lenta = cresce). */
  fila: number;
  /** 0 = qualidade cheia; maior = qualidade reduzida pela internet. */
  nivel: number;
}
export interface CastTarget {
  wsUrl: string;
  url: string;
  key: string;
}

// ---------------- o que o celular consegue ----------------

async function pickVideoConfig(q: { w: number; h: number; kbps: number }): Promise<VideoEncoderConfig | null> {
  // Preferência: acelerador de vídeo do celular, modo "tempo real", perfil High → Main → Baseline.
  for (const latencyMode of ['realtime', undefined] as const) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      for (const codec of AVC_CODECS) {
        const cfg: VideoEncoderConfig = {
          codec,
          width: q.w,
          height: q.h,
          bitrate: q.kbps * 1000,
          framerate: FPS,
          hardwareAcceleration,
          avc: { format: 'avc' },
          ...(latencyMode ? { latencyMode } : {}),
        };
        try {
          if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg;
        } catch {
          /* tenta o próximo */
        }
      }
    }
  }
  return null;
}

async function pickAudioConfig(sampleRate: number): Promise<AudioEncoderConfig | null> {
  const cfg: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate: AUDIO_KBPS * 1000 };
  try {
    return (await AudioEncoder.isConfigSupported(cfg)).supported ? cfg : null;
  } catch {
    return null;
  }
}

export interface CastSupport {
  ok: boolean;
  reason?: string;
}

let supportCache: Promise<CastSupport> | null = null;

/** Este celular/navegador consegue transmitir de dentro do app? */
export function castSupport(): Promise<CastSupport> {
  supportCache ??= (async (): Promise<CastSupport> => {
    const other = 'Use a opção "Outro app (Larix)", que funciona em qualquer celular.';
    if (!window.isSecureContext) return { ok: false, reason: 'A transmissão só funciona com o app aberto pelo endereço https.' };
    if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: `Este navegador não libera a câmera para o app. ${other}` };
    if (
      typeof VideoEncoder === 'undefined' ||
      typeof AudioEncoder === 'undefined' ||
      typeof VideoFrame === 'undefined' ||
      typeof AudioData === 'undefined' ||
      typeof AudioWorkletNode === 'undefined'
    )
      return {
        ok: false,
        reason: `Este navegador não consegue transmitir de dentro do app (no Android, use o Chrome atualizado; no iPhone, o iOS 26 ou mais novo). ${other}`,
      };
    if (!(await pickVideoConfig(QUALITIES['480'])))
      return { ok: false, reason: `Este celular não tem codificador de vídeo H.264 disponível para o app. ${other}` };
    if (!(await pickAudioConfig(48000)) && !(await pickAudioConfig(44100)))
      return { ok: false, reason: `Este celular não codifica o áudio no formato que o YouTube aceita (AAC). ${other}` };
    return { ok: true };
  })();
  return supportCache;
}

/** Mensagem amigável para erros da câmera/microfone. */
export function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'O celular não liberou a câmera e o microfone para o app. Toque no cadeado (ou em "Configurações do site") e permita.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Não encontrei câmera ou microfone neste aparelho.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'A câmera está sendo usada por outro app. Feche o outro app e tente de novo.';
  return `Não consegui abrir a câmera: ${(e as Error)?.message ?? e}`;
}

// ---------------- WebSocket até a ponte na Cloudflare ----------------

class WsLink implements RtmpTransport {
  onData: (d: Uint8Array) => void = () => undefined;
  onClose: (why: string) => void = () => undefined;
  sent = 0;
  private queue: Uint8Array[] = [];
  private queued = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private reason = '';

  private constructor(private readonly ws: WebSocket) {}

  /** Abre o WebSocket e espera a ponte confirmar que já está ligada ao YouTube. */
  static open(url: string, timeoutMs = 15000): Promise<WsLink> {
    return new Promise<WsLink>((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new RtmpError('Não consegui abrir a conexão com o servidor do app.', 'ws'));
        return;
      }
      ws.binaryType = 'arraybuffer';
      const link = new WsLink(ws);
      let settled = false;
      const giveUp = (msg: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* já fechado */
        }
        reject(new RtmpError(msg, 'ws'));
      };
      const timer = setTimeout(() => giveUp('O servidor do app demorou para responder.'), timeoutMs);
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          let msg: { t?: string; m?: string } = {};
          try {
            msg = JSON.parse(ev.data) as { t?: string; m?: string };
          } catch {
            /* ignora */
          }
          if (msg.t === 'aberto' && !settled) {
            settled = true;
            clearTimeout(timer);
            resolve(link);
          } else if (msg.t === 'fim') {
            link.reason = msg.m ?? '';
            if (!settled) giveUp(msg.m || 'A conexão com o YouTube não abriu.');
          }
          return;
        }
        link.onData(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onclose = () => {
        if (!settled) {
          giveUp(link.reason || 'Não consegui ligar a ponte da transmissão. Verifique a internet.');
          return;
        }
        link.shut(link.reason || 'A conexão caiu.');
      };
    });
  }

  send(data: Uint8Array, urgent: boolean) {
    if (this.closed) return;
    this.queue.push(data);
    this.queued += data.length;
    if (urgent || this.queued >= 48 * 1024) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 50);
  }

  private flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.queued || this.closed) return;
    const all = this.queue.length === 1 ? this.queue[0] : concatBytes(this.queue);
    this.queue = [];
    this.queued = 0;
    try {
      this.ws.send(all as Uint8Array<ArrayBuffer>);
      this.sent += all.length;
    } catch {
      this.shut('A conexão caiu.');
    }
  }

  /** Bytes esperando para sair (no app e no navegador). Cresce quando a internet não dá conta. */
  backlog() {
    return this.closed ? 0 : this.queued + this.ws.bufferedAmount;
  }

  close() {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    const ws = this.ws;
    setTimeout(() => {
      try {
        ws.close(1000, 'fim');
      } catch {
        /* já fechado */
      }
    }, 400);
  }

  private shut(why: string) {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
    this.queued = 0;
    this.onClose(why);
  }
}

// ---------------- o transmissor ----------------

interface Link {
  pub: RtmpPublisher;
  ws: WsLink;
  /** Horário (ms desde o início) que vira o "zero" desta conexão. */
  base: number;
  videoHeader: boolean;
  audioHeader: boolean;
  waitKey: boolean;
}

function toBytes(d: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength).slice();
  return new Uint8Array(d).slice();
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

type VideoWithCallback = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

export class LiveCaster {
  onPhase: (p: CastPhase, msg?: string) => void = () => undefined;
  onStats: (s: CastStats) => void = () => undefined;
  phase: CastPhase = 'parado';

  private readonly video: VideoWithCallback;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private vstream: MediaStream | null = null;
  private astream: MediaStream | null = null;
  private facing: Facing = 'environment';
  private music = true;
  private quality: Quality = '720';

  private venc: VideoEncoder | null = null;
  private vcfg: VideoEncoderConfig | null = null;
  private aenc: AudioEncoder | null = null;
  private actx: AudioContext | null = null;
  private pcmNode: AudioWorkletNode | null = null;
  private asource: MediaStreamAudioSourceNode | null = null;
  private asr = 48000;
  private avcC: Uint8Array | null = null;
  private asc: Uint8Array | null = null;

  private running = false;
  private t0 = 0;
  private loopId = 0;
  private lastTick = 0;
  private lastFrame = 0;
  private forceKey = true;
  private lastKey = -Infinity;
  private frames = 0;
  private audioBase: number | null = null;
  private audioSamples = 0;
  private level = 0;
  private lastLevelChange = 0;
  private calmSince = 0;
  private videoErrors = 0;

  private target: CastTarget | null = null;
  private link: Link | null = null;
  private everConnected = false;
  private lostAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sentBefore = 0;
  private prev = { t: 0, sent: 0, frames: 0 };

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.canvas = document.createElement('canvas');
    const g = this.canvas.getContext('2d', { alpha: false });
    if (!g) throw new Error('Este navegador não deixou desenhar o vídeo.');
    this.g = g;
  }

  get isRunning() {
    return this.running;
  }

  /** Abre (ou troca) câmera e microfone. Durante a live, só a câmera e o modo música podem mudar. */
  async openCamera(o: { facing: Facing; music: boolean; quality: Quality }) {
    const videoLive = this.vstream?.getVideoTracks().some((t) => t.readyState === 'live');
    const audioLive = this.astream?.getAudioTracks().some((t) => t.readyState === 'live');
    const needVideo = !videoLive || o.facing !== this.facing || (!this.running && o.quality !== this.quality);
    const needAudio = !audioLive || o.music !== this.music;
    if (!needVideo && !needAudio) return;
    const q = QUALITIES[this.running ? this.quality : o.quality];
    const video: MediaTrackConstraints = {
      facingMode: { ideal: o.facing },
      width: { ideal: q.w },
      height: { ideal: q.h },
      frameRate: { ideal: FPS, max: FPS },
    };
    const audio: MediaTrackConstraints = o.music
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } }
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    // Alguns celulares não abrem duas câmeras ao mesmo tempo: solta a antiga antes.
    if (needVideo) this.vstream?.getTracks().forEach((t) => t.stop());
    if (needAudio) this.astream?.getTracks().forEach((t) => t.stop());
    const s = await navigator.mediaDevices.getUserMedia({ video: needVideo ? video : false, audio: needAudio ? audio : false });
    if (needVideo) {
      this.vstream = new MediaStream(s.getVideoTracks());
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.srcObject = this.vstream;
      await this.video.play().catch(() => undefined);
      this.facing = o.facing;
      if (!this.running) this.quality = o.quality;
    }
    if (needAudio) {
      this.astream = new MediaStream(s.getAudioTracks());
      this.music = o.music;
      this.connectAudioSource();
    }
  }

  setMicOn(on: boolean) {
    this.astream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  /** O vídeo da câmera está "em pé"? (a live sai melhor com o celular deitado) */
  isPortrait() {
    return this.video.videoHeight > this.video.videoWidth;
  }

  /**
   * Prepara o som. Chame direto no toque do botão, antes de qualquer espera: no iPhone o áudio só liga se nascer
   * de um toque na tela.
   */
  primeAudio() {
    if (this.actx) return;
    try {
      this.actx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    } catch {
      this.actx = new AudioContext({ latencyHint: 'interactive' });
    }
    void this.actx.resume().catch(() => undefined);
  }

  /** Começa a codificar e a mandar para o YouTube. */
  async start(target: CastTarget) {
    if (this.running) return;
    if (!this.vstream || !this.astream) throw new Error('Abra a câmera antes de começar.');
    const q = QUALITIES[this.quality];
    const vcfg = await pickVideoConfig(q);
    if (!vcfg) throw new Error('Este celular não conseguiu ligar o codificador de vídeo nesta qualidade. Tente a econômica.');
    this.primeAudio();
    const ctx = this.actx!;
    if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
    this.asr = ctx.sampleRate;
    const acfg = await pickAudioConfig(this.asr);
    if (!acfg) throw new Error('Este celular não codifica o áudio no formato que o YouTube aceita (AAC).');

    this.target = target;
    this.running = true;
    this.t0 = performance.now();
    this.frames = 0;
    this.forceKey = true;
    this.lastKey = -Infinity;
    this.audioBase = null;
    this.audioSamples = 0;
    this.level = 0;
    this.lastLevelChange = 0;
    this.calmSince = 0;
    this.videoErrors = 0;
    this.everConnected = false;
    this.lostAt = 0;
    this.sentBefore = 0;
    this.prev = { t: performance.now(), sent: 0, frames: 0 };
    this.canvas.width = q.w;
    this.canvas.height = q.h;
    try {
      this.vcfg = vcfg;
      this.makeVideoEncoder();
      this.aenc = new AudioEncoder({
        output: (c, m) => this.onAudioChunk(c, m),
        error: (e) => this.fatal(`O codificador de áudio parou: ${e.message}`),
      });
      this.aenc.configure(acfg);
      await ctx.audioWorklet.addModule('/live-pcm.js');
      this.pcmNode = new AudioWorkletNode(ctx, 'irn-pcm', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      this.pcmNode.port.onmessage = (ev) => this.onPcm(ev.data as { l: Float32Array; r: Float32Array });
      const silent = ctx.createGain();
      silent.gain.value = 0;
      this.pcmNode.connect(silent).connect(ctx.destination);
      this.connectAudioSource();
    } catch (e) {
      await this.stop();
      throw e;
    }
    this.startLoop();
    this.timer = setInterval(() => this.everySecond(), 1000);
    this.setPhase('conectando');
    try {
      await this.connect();
      this.setPhase('enviando');
    } catch (e) {
      if (!this.running) return;
      this.lostAt = Date.now();
      this.setPhase('reconectando', (e as Error).message);
      this.scheduleRetry();
    }
  }

  /** Depois de "falhou": tenta de novo. */
  retry() {
    if (!this.running || this.link) return;
    this.lostAt = Date.now();
    this.setPhase('reconectando');
    this.scheduleRetry();
  }

  /** Para de transmitir (a câmera continua aberta para a prévia). */
  async stop() {
    this.running = false;
    this.loopId++;
    if (this.timer) clearInterval(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    const l = this.link;
    this.link = null;
    if (l) l.pub.close();
    for (const enc of [this.venc, this.aenc]) {
      try {
        if (enc && enc.state !== 'closed') enc.close();
      } catch {
        /* já fechado */
      }
    }
    this.venc = null;
    this.aenc = null;
    try {
      this.asource?.disconnect();
      this.pcmNode?.disconnect();
    } catch {
      /* já desligado */
    }
    this.asource = null;
    this.pcmNode = null;
    const ctx = this.actx;
    this.actx = null;
    await ctx?.close().catch(() => undefined);
    this.setPhase('parado');
  }

  /** Solta câmera e microfone (ao sair da tela). */
  release() {
    this.vstream?.getTracks().forEach((t) => t.stop());
    this.astream?.getTracks().forEach((t) => t.stop());
    this.vstream = null;
    this.astream = null;
    this.video.srcObject = null;
  }

  // ---------------- internos ----------------

  private setPhase(p: CastPhase, msg?: string) {
    this.phase = p;
    this.onPhase(p, msg);
  }

  private fatal(msg: string) {
    if (!this.running) return;
    console.error('live:', msg);
    void this.stop().then(() => this.setPhase('falhou', msg));
  }

  private makeVideoEncoder() {
    const enc = new VideoEncoder({
      output: (c, m) => this.onVideoChunk(c, m),
      error: (e) => {
        // O codificador do celular às vezes para (ex.: app foi para segundo plano): recria algumas vezes.
        if (!this.running) return;
        if (++this.videoErrors > 3) return this.fatal(`O codificador de vídeo parou: ${e.message}`);
        setTimeout(() => {
          if (!this.running) return;
          try {
            this.makeVideoEncoder();
          } catch (err) {
            this.fatal(`O codificador de vídeo parou: ${(err as Error).message}`);
          }
        }, 500);
      },
    });
    enc.configure({ ...this.vcfg!, bitrate: this.videoBitrate() });
    this.venc = enc;
    this.forceKey = true;
  }

  private videoBitrate() {
    return Math.round(QUALITIES[this.quality].kbps * LEVELS[this.level]) * 1000;
  }

  private connectAudioSource() {
    if (!this.actx || !this.pcmNode || !this.astream) return;
    try {
      this.asource?.disconnect();
    } catch {
      /* já desligado */
    }
    this.asource = this.actx.createMediaStreamSource(this.astream);
    this.asource.connect(this.pcmNode);
  }

  private startLoop() {
    const id = ++this.loopId;
    const step = () => {
      if (!this.running || id !== this.loopId) return;
      this.lastTick = performance.now();
      this.drawFrame();
      if (this.video.requestVideoFrameCallback && this.video.readyState >= 2) this.video.requestVideoFrameCallback(step);
      else setTimeout(step, 1000 / FPS);
    };
    step();
  }

  private drawFrame() {
    const v = this.video;
    const enc = this.venc;
    if (!enc || enc.state !== 'configured') return;
    const now = performance.now();
    if (now - this.lastFrame < 1000 / FPS - 4) return;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh || v.readyState < 2) return;
    if (enc.encodeQueueSize > 2) return; // o codificador está atrasado: pula este quadro
    this.lastFrame = now;
    const { width: w, height: h } = this.canvas;
    const s = Math.min(w / vw, h / vh);
    const dw = Math.round(vw * s);
    const dh = Math.round(vh * s);
    if (dw < w || dh < h) {
      this.g.fillStyle = '#000';
      this.g.fillRect(0, 0, w, h);
    }
    this.g.drawImage(v, (w - dw) >> 1, (h - dh) >> 1, dw, dh);
    const ts = Math.round((now - this.t0) * 1000);
    const key = this.forceKey || ts - this.lastKey >= KEYFRAME_US;
    const frame = new VideoFrame(this.canvas, { timestamp: ts });
    try {
      enc.encode(frame, { keyFrame: key });
    } finally {
      frame.close();
    }
    if (key) {
      this.lastKey = ts;
      this.forceKey = false;
    }
    this.frames++;
  }

  private onPcm(d: { l: Float32Array; r: Float32Array }) {
    const enc = this.aenc;
    if (!this.running || !enc || enc.state !== 'configured') return;
    const n = d.l.length;
    const nowUs = (performance.now() - this.t0) * 1000;
    const dur = (n / this.asr) * 1e6;
    if (this.audioBase === null) this.audioBase = nowUs - dur;
    let ts = this.audioBase + (this.audioSamples / this.asr) * 1e6;
    const lag = nowUs - (ts + dur);
    if (lag > 1_000_000) {
      // o som parou de chegar por um tempo (tela bloqueada etc.): realinha com o relógio
      this.audioBase += lag;
      ts += lag;
    }
    const planar = new Float32Array(n * 2);
    planar.set(d.l, 0);
    planar.set(d.r, n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: this.asr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(ts), data: planar });
    this.audioSamples += n;
    try {
      enc.encode(data);
    } finally {
      data.close();
    }
  }

  private setAvcC(b: Uint8Array) {
    if (this.avcC && sameBytes(this.avcC, b)) return;
    this.avcC = b;
    if (this.link) this.link.videoHeader = false;
  }

  private maxBacklog() {
    return (QUALITIES[this.quality].kbps * LEVELS[this.level] + AUDIO_KBPS) * 125 * 3; // ~3 s de vídeo
  }

  private onVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) {
    let data: Uint8Array = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data as Uint8Array<ArrayBuffer>);
    const desc = meta?.decoderConfig?.description;
    if (desc) this.setAvcC(toBytes(desc));
    if (isAnnexB(data)) {
      // Alguns aparelhos entregam no formato "Annex B": converte e tira o SPS/PPS do próprio quadro.
      const nalus = splitAnnexB(data);
      const sps = nalus.find((x) => (x[0] & 0x1f) === 7);
      const pps = nalus.find((x) => (x[0] & 0x1f) === 8);
      if (sps && pps) this.setAvcC(buildAvcC(sps, pps));
      data = nalusToAvcc(nalus.filter((x) => ![7, 8, 9].includes(x[0] & 0x1f)));
    }
    const l = this.link;
    if (!l || !this.avcC) return;
    const key = chunk.type === 'key';
    const ts = Math.round(chunk.timestamp / 1000) - l.base;
    if (ts < 0) return;
    const backlog = l.ws.backlog();
    if (!key) {
      if (l.waitKey) return;
      if (backlog > this.maxBacklog()) {
        // A internet não está dando conta: descarta quadros até o próximo quadro-chave.
        l.waitKey = true;
        this.forceKey = true;
        return;
      }
    } else {
      if (backlog > this.maxBacklog() * 2) {
        l.waitKey = true;
        return;
      }
      l.waitKey = false;
      if (!l.videoHeader) {
        l.pub.sendVideo(ts, avcSequenceHeader(this.avcC));
        l.videoHeader = true;
      }
    }
    l.pub.sendVideo(ts, avcVideoPacket(data, key));
  }

  private onAudioChunk(chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) {
    const desc = meta?.decoderConfig?.description;
    if (desc) {
      const b = toBytes(desc);
      if (b.length >= 2) this.asc = b;
    }
    if (!this.asc) this.asc = aacConfig(this.asr, 2);
    const l = this.link;
    if (!l) return;
    const ts = Math.round(chunk.timestamp / 1000) - l.base;
    if (ts < 0) return;
    const raw = new Uint8Array(chunk.byteLength);
    chunk.copyTo(raw);
    if (!l.audioHeader) {
      l.pub.sendAudio(ts, aacSequenceHeader(this.asc));
      l.audioHeader = true;
    }
    if (l.ws.backlog() > this.maxBacklog() * 3) return;
    l.pub.sendAudio(ts, aacAudioPacket(stripAdts(raw)));
  }

  private async connect() {
    const t = this.target!;
    const ws = await WsLink.open(t.wsUrl);
    if (!this.running) {
      ws.close();
      return;
    }
    const pub = new RtmpPublisher(ws, { url: t.url, key: t.key });
    ws.onData = (d) => pub.receive(d);
    ws.onClose = (why) => pub.transportClosed(why);
    await pub.publish(20000);
    if (!this.running) {
      pub.close();
      return;
    }
    const q = QUALITIES[this.quality];
    pub.sendMetadata({
      duration: 0,
      width: q.w,
      height: q.h,
      videodatarate: q.kbps,
      framerate: FPS,
      videocodecid: 7,
      audiodatarate: AUDIO_KBPS,
      audiosamplerate: this.asr,
      audiosamplesize: 16,
      stereo: true,
      audiocodecid: 10,
      encoder: 'App da igreja (câmera do celular)',
    });
    const link: Link = { pub, ws, base: Math.round(performance.now() - this.t0), videoHeader: false, audioHeader: false, waitKey: true };
    pub.onError = (e) => this.lost(link, e.message);
    ws.onClose = (why) => {
      pub.transportClosed(why);
      this.lost(link, why);
    };
    this.link = link;
    this.everConnected = true;
    this.forceKey = true;
  }

  private lost(link: Link, why: string) {
    if (this.link !== link) return;
    this.link = null;
    this.sentBefore += link.ws.sent;
    link.pub.close();
    if (!this.running) return;
    if (!this.lostAt) this.lostAt = Date.now();
    this.setPhase('reconectando', why);
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retryTimer || !this.running) return;
    const elapsed = Date.now() - this.lostAt;
    // Antes de entrar no ar, desiste rápido (o problema costuma ser de configuração); no ar, insiste por 5 minutos.
    const window = this.everConnected ? 5 * 60_000 : 30_000;
    if (elapsed > window) {
      this.setPhase('falhou', 'Não consegui ligar a transmissão ao YouTube. Verifique a internet e toque em "Tentar de novo".');
      return;
    }
    const delay = elapsed < 10_000 ? 1500 : elapsed < 60_000 ? 3000 : 6000;
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null;
      if (!this.running || this.link) return;
      try {
        await this.connect();
        if (!this.running) return;
        this.lostAt = 0;
        this.setPhase('enviando');
      } catch (e) {
        if (!this.running) return;
        this.setPhase('reconectando', (e as Error).message);
        this.scheduleRetry();
      }
    }, delay);
  }

  private everySecond() {
    const now = performance.now();
    // Se o vídeo parou de mandar quadros (troca de câmera, tela voltou), religa o laço.
    if (now - this.lastTick > 500) this.startLoop();
    const l = this.link;
    const bytesPerSec = (QUALITIES[this.quality].kbps * LEVELS[this.level] + AUDIO_KBPS) * 125;
    const fila = l ? l.ws.backlog() / bytesPerSec : 0;
    if (l) this.adapt(fila, now);
    const sent = this.sentBefore + (l?.ws.sent ?? 0);
    const dt = Math.max(0.001, (now - this.prev.t) / 1000);
    this.onStats({
      kbps: Math.round(((sent - this.prev.sent) * 8) / 1000 / dt),
      fps: Math.round((this.frames - this.prev.frames) / dt),
      fila: Math.round(fila * 10) / 10,
      nivel: this.level,
    });
    this.prev = { t: now, sent, frames: this.frames };
  }

  private adapt(fila: number, now: number) {
    if (fila > 1.5 && this.level < LEVELS.length - 1 && now - this.lastLevelChange > 4000) {
      this.setLevel(this.level + 1, now);
      this.calmSince = 0;
    } else if (fila < 0.25) {
      if (!this.calmSince) this.calmSince = now;
      else if (this.level > 0 && now - this.calmSince > 30_000 && now - this.lastLevelChange > 30_000) {
        this.setLevel(this.level - 1, now);
        this.calmSince = now;
      }
    } else {
      this.calmSince = 0;
    }
  }

  private setLevel(level: number, now: number) {
    this.level = level;
    this.lastLevelChange = now;
    try {
      this.venc?.configure({ ...this.vcfg!, bitrate: this.videoBitrate() });
      this.forceKey = true;
    } catch (e) {
      console.warn('live: não consegui mudar a taxa do vídeo', e);
    }
  }
}
