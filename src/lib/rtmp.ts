/**
 * Envio de live por RTMP — o mesmo protocolo que OBS, Larix e Streamlabs usam para mandar vídeo ao YouTube.
 *
 * Não depende do navegador: o app usa com a câmera do celular (os bytes passam por um WebSocket que o servidor
 * do app, na Cloudflare, liga ao YouTube) e os testes usam no Node, publicando num servidor RTMP local.
 *
 * Partes: AMF0 (formato dos comandos), pacotes FLV de vídeo H.264 e de áudio AAC, "chunks" do RTMP e o diálogo
 * de publicação (handshake → connect → createStream → publish), igual ao que o FFmpeg e o OBS fazem.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const u32 = (v: number) => Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
const read24 = (b: Uint8Array, p: number) => (b[p] << 16) | (b[p + 1] << 8) | b[p + 2];
const read32 = (b: Uint8Array, p: number) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
function write24(b: Uint8Array, p: number, v: number) {
  b[p] = (v >>> 16) & 0xff;
  b[p + 1] = (v >>> 8) & 0xff;
  b[p + 2] = v & 0xff;
}
function write32(b: Uint8Array, p: number, v: number) {
  b[p] = (v >>> 24) & 0xff;
  b[p + 1] = (v >>> 16) & 0xff;
  b[p + 2] = (v >>> 8) & 0xff;
  b[p + 3] = v & 0xff;
}

// ============================== AMF0 ==============================

export type AmfValue = number | string | boolean | null | undefined | AmfObject | AmfValue[] | EcmaArray;
export interface AmfObject {
  [key: string]: AmfValue;
}

/** Objeto gravado como "ECMA array" (é assim que o OBS e o FFmpeg mandam o onMetaData). */
export class EcmaArray {
  readonly props: AmfObject;
  constructor(props: AmfObject) {
    this.props = props;
  }
}

class ByteWriter {
  private parts: Uint8Array[] = [];
  bytes(b: Uint8Array) {
    this.parts.push(b);
  }
  u8(v: number) {
    this.parts.push(Uint8Array.of(v & 0xff));
  }
  u16(v: number) {
    this.parts.push(Uint8Array.of((v >>> 8) & 0xff, v & 0xff));
  }
  u32(v: number) {
    this.parts.push(u32(v));
  }
  f64(v: number) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v);
    this.parts.push(b);
  }
  done() {
    return concatBytes(this.parts);
  }
}

function amfWrite(w: ByteWriter, v: AmfValue): void {
  if (v === null) return w.u8(0x05);
  if (v === undefined) return w.u8(0x06);
  if (typeof v === 'number') {
    w.u8(0x00);
    w.f64(v);
    return;
  }
  if (typeof v === 'boolean') {
    w.u8(0x01);
    w.u8(v ? 1 : 0);
    return;
  }
  if (typeof v === 'string') {
    const b = enc.encode(v);
    if (b.length > 0xffff) {
      w.u8(0x0c);
      w.u32(b.length);
    } else {
      w.u8(0x02);
      w.u16(b.length);
    }
    w.bytes(b);
    return;
  }
  if (Array.isArray(v)) {
    w.u8(0x0a);
    w.u32(v.length);
    for (const x of v) amfWrite(w, x);
    return;
  }
  if (v instanceof EcmaArray) {
    const keys = Object.keys(v.props).filter((k) => v.props[k] !== undefined);
    w.u8(0x08);
    w.u32(keys.length);
    amfProps(w, v.props);
    return;
  }
  w.u8(0x03);
  amfProps(w, v);
}

function amfProps(w: ByteWriter, o: AmfObject) {
  for (const [k, x] of Object.entries(o)) {
    if (x === undefined) continue;
    const kb = enc.encode(k);
    w.u16(kb.length);
    w.bytes(kb);
    amfWrite(w, x);
  }
  w.u16(0);
  w.u8(0x09);
}

/** Codifica valores em AMF0, um atrás do outro (como num comando RTMP). */
export function amfEncode(...values: AmfValue[]): Uint8Array {
  const w = new ByteWriter();
  for (const v of values) amfWrite(w, v);
  return w.done();
}

class ByteReader {
  p = 0;
  constructor(readonly b: Uint8Array) {}
  need(n: number) {
    if (this.p + n > this.b.length) throw new RangeError('AMF0 truncado');
  }
  u8() {
    this.need(1);
    return this.b[this.p++];
  }
  u16() {
    this.need(2);
    const v = (this.b[this.p] << 8) | this.b[this.p + 1];
    this.p += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = read32(this.b, this.p);
    this.p += 4;
    return v;
  }
  f64() {
    this.need(8);
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8).getFloat64(0);
    this.p += 8;
    return v;
  }
  str(n: number) {
    this.need(n);
    const s = dec.decode(this.b.subarray(this.p, this.p + n));
    this.p += n;
    return s;
  }
}

function amfRead(r: ByteReader, depth = 0): AmfValue {
  if (depth > 32) throw new Error('AMF0 aninhado demais');
  const t = r.u8();
  switch (t) {
    case 0x00:
      return r.f64();
    case 0x01:
      return r.u8() !== 0;
    case 0x02:
      return r.str(r.u16());
    case 0x0c:
      return r.str(r.u32());
    case 0x03:
      return amfReadProps(r, depth);
    case 0x08:
      r.u32();
      return amfReadProps(r, depth);
    case 0x0a: {
      const n = r.u32();
      if (n > 100000) throw new Error('AMF0: lista grande demais');
      const a: AmfValue[] = [];
      for (let i = 0; i < n; i++) a.push(amfRead(r, depth + 1));
      return a;
    }
    case 0x05:
      return null;
    case 0x06:
      return undefined;
    case 0x0b: {
      const d = r.f64();
      r.u16();
      return d;
    }
    default:
      throw new Error(`AMF0: tipo desconhecido ${t}`);
  }
}

function amfReadProps(r: ByteReader, depth: number): AmfObject {
  const o: AmfObject = {};
  for (;;) {
    const len = r.u16();
    if (len === 0) {
      r.need(1);
      if (r.b[r.p] === 0x09) {
        r.p++;
        return o;
      }
    }
    const k = r.str(len);
    o[k] = amfRead(r, depth + 1);
  }
}

/** Lê todos os valores AMF0 de um comando. */
export function amfDecode(b: Uint8Array): AmfValue[] {
  const r = new ByteReader(b);
  const out: AmfValue[] = [];
  while (r.p < b.length) out.push(amfRead(r));
  return out;
}

// ============================== FLV: pacotes de vídeo e áudio ==============================

/** Cabeçalho do vídeo H.264 (avcC), mandado antes do primeiro quadro e sempre que a configuração muda. */
export function avcSequenceHeader(avcC: Uint8Array): Uint8Array {
  return concatBytes([Uint8Array.of(0x17, 0x00, 0x00, 0x00, 0x00), avcC]);
}

/** Um quadro de vídeo H.264 no formato AVCC (cada NALU com o tamanho em 4 bytes na frente). */
export function avcVideoPacket(avcc: Uint8Array, keyframe: boolean, cts = 0): Uint8Array {
  const out = new Uint8Array(5 + avcc.length);
  out[0] = keyframe ? 0x17 : 0x27;
  out[1] = 0x01;
  write24(out, 2, cts & 0xffffff);
  out.set(avcc, 5);
  return out;
}

/** Cabeçalho do áudio AAC (AudioSpecificConfig). */
export function aacSequenceHeader(asc: Uint8Array): Uint8Array {
  return concatBytes([Uint8Array.of(0xaf, 0x00), asc]);
}

/** Um quadro de áudio AAC "cru" (sem cabeçalho ADTS). */
export function aacAudioPacket(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + raw.length);
  out[0] = 0xaf;
  out[1] = 0x01;
  out.set(raw, 2);
  return out;
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AudioSpecificConfig do AAC-LC, para quando o codificador não informa. */
export function aacConfig(sampleRate: number, channels: number): Uint8Array {
  const idx = AAC_RATES.indexOf(sampleRate);
  if (idx < 0) throw new Error(`taxa de amostragem sem suporte no AAC: ${sampleRate}`);
  return Uint8Array.of((2 << 3) | (idx >> 1), ((idx & 1) << 7) | ((channels & 0x0f) << 3));
}

/** Tira o cabeçalho ADTS de um quadro AAC, se houver. */
export function stripAdts(frame: Uint8Array): Uint8Array {
  if (frame.length > 7 && frame[0] === 0xff && (frame[1] & 0xf6) === 0xf0) {
    const headerLen = frame[1] & 0x01 ? 7 : 9;
    return frame.subarray(headerLen);
  }
  return frame;
}

/** O vídeo veio no formato "Annex B" (00 00 01 antes de cada NALU)? */
export function isAnnexB(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || (b[2] === 0 && b[3] === 1));
}

/** Separa as NALUs de um quadro em Annex B. */
export function splitAnnexB(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  let start = -1;
  while (i + 2 < b.length) {
    if (b[i] === 0 && b[i + 1] === 0 && b[i + 2] === 1) {
      if (start >= 0) {
        let end = i;
        while (end > start && b[end - 1] === 0) end--;
        if (end > start) out.push(b.subarray(start, end));
      }
      i += 3;
      start = i;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < b.length) out.push(b.subarray(start));
  return out;
}

/** NALUs → AVCC (tamanho de 4 bytes antes de cada uma). */
export function nalusToAvcc(nalus: Uint8Array[]): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const n of nalus) parts.push(u32(n.length), n);
  return concatBytes(parts);
}

/** Monta o avcC (AVCDecoderConfigurationRecord) a partir do SPS e do PPS. */
export function buildAvcC(sps: Uint8Array, pps: Uint8Array): Uint8Array {
  return concatBytes([
    Uint8Array.of(0x01, sps[1], sps[2], sps[3], 0xff, 0xe1, (sps.length >> 8) & 0xff, sps.length & 0xff),
    sps,
    Uint8Array.of(0x01, (pps.length >> 8) & 0xff, pps.length & 0xff),
    pps,
  ]);
}

// ============================== RTMP: chunks ==============================

export const MSG = {
  SetChunkSize: 1,
  Abort: 2,
  Ack: 3,
  UserControl: 4,
  WindowAckSize: 5,
  SetPeerBandwidth: 6,
  Audio: 8,
  Video: 9,
  DataAmf0: 18,
  CommandAmf0: 20,
} as const;

export interface RtmpMessage {
  type: number;
  streamId: number;
  timestamp: number;
  payload: Uint8Array;
}

/** Divide uma mensagem em chunks (cabeçalho completo no primeiro, curto nos demais). */
export function encodeChunks(csid: number, msg: RtmpMessage, chunkSize: number): Uint8Array {
  if (csid < 2 || csid > 63) throw new Error('chunk stream inválido');
  const { payload } = msg;
  const ts = msg.timestamp >>> 0;
  const ext = ts >= 0xffffff;
  const pieces = Math.max(1, Math.ceil(payload.length / chunkSize));
  const out = new Uint8Array(12 + (ext ? 4 : 0) + payload.length + (pieces - 1) * (1 + (ext ? 4 : 0)));
  let p = 0;
  out[p++] = csid;
  write24(out, p, ext ? 0xffffff : ts);
  write24(out, p + 3, payload.length);
  out[p + 6] = msg.type;
  out[p + 7] = msg.streamId & 0xff;
  out[p + 8] = (msg.streamId >>> 8) & 0xff;
  out[p + 9] = (msg.streamId >>> 16) & 0xff;
  out[p + 10] = (msg.streamId >>> 24) & 0xff;
  p += 11;
  if (ext) {
    write32(out, p, ts);
    p += 4;
  }
  for (let i = 0; i < payload.length; i += chunkSize) {
    if (i > 0) {
      out[p++] = 0xc0 | csid;
      if (ext) {
        write32(out, p, ts);
        p += 4;
      }
    }
    const part = payload.subarray(i, i + chunkSize);
    out.set(part, p);
    p += part.length;
  }
  return out;
}

interface ChunkState {
  timestamp: number;
  delta: number;
  length: number;
  type: number;
  streamId: number;
  extended: boolean;
  buf: Uint8Array | null;
  got: number;
}

/** Remonta as mensagens que chegam do servidor (aceita os 4 formatos de cabeçalho e timestamps estendidos). */
export class ChunkReader {
  chunkSize = 128;
  private pending: Uint8Array = new Uint8Array(0);
  private streams = new Map<number, ChunkState>();

  push(data: Uint8Array): RtmpMessage[] {
    const b = this.pending.length ? concatBytes([this.pending, data]) : data;
    const out: RtmpMessage[] = [];
    let p = 0;
    for (;;) {
      const start = p;
      if (p >= b.length) break;
      const b0 = b[p++];
      const fmt = b0 >> 6;
      let csid = b0 & 0x3f;
      if (csid === 0) {
        if (p + 1 > b.length) {
          p = start;
          break;
        }
        csid = 64 + b[p++];
      } else if (csid === 1) {
        if (p + 2 > b.length) {
          p = start;
          break;
        }
        csid = 64 + b[p] + b[p + 1] * 256;
        p += 2;
      }
      const hlen = fmt === 0 ? 11 : fmt === 1 ? 7 : fmt === 2 ? 3 : 0;
      if (p + hlen > b.length) {
        p = start;
        break;
      }
      const st: ChunkState = this.streams.get(csid) ?? {
        timestamp: 0,
        delta: 0,
        length: 0,
        type: 0,
        streamId: 0,
        extended: false,
        buf: null,
        got: 0,
      };
      const tsField = fmt <= 2 ? read24(b, p) : 0;
      const length = fmt <= 1 ? read24(b, p + 3) : st.length;
      const type = fmt <= 1 ? b[p + 6] : st.type;
      const streamId = fmt === 0 ? (b[p + 7] | (b[p + 8] << 8) | (b[p + 9] << 16) | (b[p + 10] << 24)) >>> 0 : st.streamId;
      p += hlen;
      const extended = fmt <= 2 ? tsField === 0xffffff : st.extended;
      let extTs = 0;
      if (extended) {
        if (p + 4 > b.length) {
          p = start;
          break;
        }
        extTs = read32(b, p);
        p += 4;
      }
      const isNew = st.buf === null;
      const total = isNew ? length : st.length;
      const take = Math.min(this.chunkSize, total - (isNew ? 0 : st.got));
      if (p + take > b.length) {
        p = start;
        break;
      }
      if (isNew) {
        const tsVal = extended ? extTs : tsField;
        if (fmt === 0) {
          st.timestamp = tsVal >>> 0;
          st.delta = 0;
        } else if (fmt === 1 || fmt === 2) {
          st.delta = tsVal;
          st.timestamp = (st.timestamp + tsVal) >>> 0;
        } else {
          st.timestamp = (st.timestamp + st.delta) >>> 0;
        }
        st.length = length;
        st.type = type;
        st.streamId = streamId;
        st.extended = extended;
        st.buf = new Uint8Array(length);
        st.got = 0;
      }
      st.buf!.set(b.subarray(p, p + take), st.got);
      st.got += take;
      p += take;
      this.streams.set(csid, st);
      if (st.got >= st.length) {
        const msg: RtmpMessage = { type: st.type, streamId: st.streamId, timestamp: st.timestamp, payload: st.buf! };
        st.buf = null;
        st.got = 0;
        if (msg.type === MSG.SetChunkSize && msg.payload.length >= 4) {
          this.chunkSize = Math.max(1, Math.min(read32(msg.payload, 0) & 0x7fffffff, 0xffffff));
        } else if (msg.type === MSG.Abort && msg.payload.length >= 4) {
          const s = this.streams.get(read32(msg.payload, 0));
          if (s) {
            s.buf = null;
            s.got = 0;
          }
        }
        out.push(msg);
      }
    }
    this.pending = p < b.length ? b.slice(p) : new Uint8Array(0);
    return out;
  }
}

// ============================== RTMP: handshake ==============================

const HS_SIZE = 1536;
/** Chave pública do "Flash Player" usada no handshake com assinatura (a mesma que o FFmpeg usa). */
const FP_KEY = enc.encode('Genuine Adobe Flash Player 001');

/** C1 com a assinatura HMAC-SHA256 no lugar certo (handshake "FP9", como o FFmpeg faz ao publicar). */
export async function makeC1(): Promise<Uint8Array> {
  const c1 = new Uint8Array(HS_SIZE);
  crypto.getRandomValues(c1.subarray(8));
  c1.set([9, 0, 124, 2], 4); // versão "9.0.124.2"
  const pos = c1HashOffset(c1);
  const digest = await hmacSha256(FP_KEY, concatBytes([c1.subarray(0, pos), c1.subarray(pos + 32)]));
  c1.set(digest, pos);
  return c1;
}

export function c1HashOffset(c1: Uint8Array): number {
  return ((c1[8] + c1[9] + c1[10] + c1[11]) % 728) + 12;
}

export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data as BufferSource));
}

// ============================== RTMP: publicação ==============================

/** Por onde os bytes passam (no app: WebSocket até a Cloudflare; nos testes: socket TCP direto). */
export interface RtmpTransport {
  /** urgente = mandar já (comandos); falso = pode juntar com os próximos (vídeo e áudio). */
  send(data: Uint8Array, urgent: boolean): void;
  close(): void;
}

export interface RtmpTarget {
  /** Endereço do servidor de entrada, ex.: rtmps://a.rtmps.youtube.com/live2 */
  url: string;
  /** Chave de transmissão. */
  key: string;
}

export class RtmpError extends Error {
  code: string;
  constructor(message: string, code = 'rtmp') {
    super(message);
    this.code = code;
  }
}

const CS = { control: 2, command: 3, audio: 4, video: 6, stream: 8 };
const OUT_CHUNK = 4096;
const ACK_WINDOW = 2_500_000;

interface Waiter {
  resolve: (v: AmfValue[]) => void;
  reject: (e: Error) => void;
}

/** Separa "rtmps://host/app" em app e tcUrl. */
export function splitRtmpUrl(url: string): { app: string; tcUrl: string } {
  const m = /^rtmps?:\/\/[^/]+\/(.+)$/i.exec(url.trim());
  if (!m) throw new RtmpError('Endereço RTMP inválido.', 'url');
  return { app: m[1].replace(/\/+$/, ''), tcUrl: url.trim().replace(/\/+$/, '') };
}

/**
 * Publica uma live num servidor RTMP. Uso:
 *   const pub = new RtmpPublisher(transporte, { url, key });
 *   (bytes que chegam do servidor) → pub.receive(bytes)
 *   await pub.publish();  → depois sendMetadata(), sendVideo(), sendAudio()
 */
export class RtmpPublisher {
  /** Chamado se a conexão cair ou o servidor recusar depois de publicado. */
  onError: (e: RtmpError) => void = () => undefined;
  streamId = 0;
  private stage: 'inicio' | 'handshake' | 'pronto' | 'fechado' = 'inicio';
  private hsBuf: Uint8Array[] = [];
  private hsLen = 0;
  private hsDone: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private reader = new ChunkReader();
  private outChunk = 128;
  private txn = 1;
  private waiters = new Map<number, Waiter>();
  private publishWait: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private received = 0;
  private lastAck = 0;
  private serverWindow = ACK_WINDOW;
  private sentWindow = false;
  private published = false;
  private failure: RtmpError | null = null;

  constructor(
    private readonly t: RtmpTransport,
    private readonly target: RtmpTarget,
  ) {}

  get isPublished() {
    return this.published && !this.failure;
  }

  /** Bytes que chegaram do servidor. */
  receive(data: Uint8Array) {
    if (this.stage === 'fechado') return;
    try {
      if (this.stage === 'handshake') {
        this.hsBuf.push(data);
        this.hsLen += data.length;
        if (this.hsLen < 1 + 2 * HS_SIZE) return;
        const all = concatBytes(this.hsBuf);
        this.hsBuf = [];
        if (all[0] !== 3) throw new RtmpError('O servidor respondeu com uma versão de RTMP desconhecida.', 'handshake');
        const s1 = all.subarray(1, 1 + HS_SIZE);
        this.t.send(s1.slice(), true); // C2 = eco do S1
        this.stage = 'pronto';
        this.hsDone?.resolve();
        this.hsDone = null;
        const rest = all.subarray(1 + 2 * HS_SIZE);
        if (rest.length) this.readChunks(rest);
        return;
      }
      if (this.stage === 'pronto') this.readChunks(data);
    } catch (e) {
      this.fail(e instanceof RtmpError ? e : new RtmpError(`Resposta inválida do servidor: ${(e as Error).message}`, 'protocolo'));
    }
  }

  /** O transporte (WebSocket/TCP) fechou. */
  transportClosed(reason?: string) {
    this.fail(new RtmpError(reason || 'A conexão com o servidor caiu.', 'conexao'));
  }

  /** Faz o handshake, conecta no app e começa a publicar. */
  async publish(timeoutMs = 20000): Promise<void> {
    if (this.stage !== 'inicio') throw new RtmpError('Publicação já iniciada.');
    const { app, tcUrl } = splitRtmpUrl(this.target.url);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new RtmpError('O servidor de transmissão não respondeu a tempo.', 'tempo')), timeoutMs);
    });
    try {
      await Promise.race([this.runPublish(app, tcUrl), timeout]);
    } catch (e) {
      const err = e instanceof RtmpError ? e : new RtmpError((e as Error).message);
      this.fail(err, false);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async runPublish(app: string, tcUrl: string) {
    const c1 = await makeC1();
    if (this.failure) throw this.failure;
    this.stage = 'handshake';
    const hs = new Promise<void>((resolve, reject) => (this.hsDone = { resolve, reject }));
    this.t.send(concatBytes([Uint8Array.of(3), c1]), true);
    await hs;

    this.sendMessage(CS.control, { type: MSG.SetChunkSize, streamId: 0, timestamp: 0, payload: u32(OUT_CHUNK) }, true);
    this.outChunk = OUT_CHUNK;

    await this.call('connect', {
      app,
      type: 'nonprivate',
      flashVer: 'FMLE/3.0 (compatible; FMSc/1.0)',
      swfUrl: tcUrl,
      tcUrl,
    });
    this.command('releaseStream', this.txn++, null, this.target.key);
    this.command('FCPublish', this.txn++, null, this.target.key);
    const res = await this.call('createStream', null);
    const sid = res[3];
    if (typeof sid !== 'number') throw new RtmpError('O servidor não criou o canal de envio.', 'createStream');
    this.streamId = sid;

    const published = new Promise<void>((resolve, reject) => (this.publishWait = { resolve, reject }));
    this.sendMessage(
      CS.stream,
      { type: MSG.CommandAmf0, streamId: this.streamId, timestamp: 0, payload: amfEncode('publish', 0, null, this.target.key, 'live') },
      true,
    );
    await published;
    this.published = true;
  }

  sendMetadata(meta: AmfObject) {
    this.sendMessage(
      CS.stream,
      { type: MSG.DataAmf0, streamId: this.streamId, timestamp: 0, payload: amfEncode('@setDataFrame', 'onMetaData', new EcmaArray(meta)) },
      false,
    );
  }

  sendVideo(timestamp: number, payload: Uint8Array) {
    this.sendMessage(CS.video, { type: MSG.Video, streamId: this.streamId, timestamp, payload }, false);
  }

  sendAudio(timestamp: number, payload: Uint8Array) {
    this.sendMessage(CS.audio, { type: MSG.Audio, streamId: this.streamId, timestamp, payload }, false);
  }

  /** Encerra a publicação com educação (o servidor entende que a live acabou) e fecha a conexão. */
  close() {
    if (this.stage === 'fechado') return;
    if (this.published && !this.failure) {
      try {
        this.command('FCUnpublish', this.txn++, null, this.target.key);
        this.command('deleteStream', this.txn++, null, this.streamId);
      } catch {
        /* conexão já caiu */
      }
    }
    this.stage = 'fechado';
    this.rejectAll(new RtmpError('Transmissão encerrada.', 'fechado'));
    try {
      this.t.close();
    } catch {
      /* já fechado */
    }
  }

  // ---------------- internos ----------------

  private sendMessage(csid: number, msg: RtmpMessage, urgent: boolean) {
    if (this.stage === 'fechado' || this.failure) return;
    this.t.send(encodeChunks(csid, msg, this.outChunk), urgent);
  }

  private command(name: string, txn: number, ...args: AmfValue[]) {
    this.sendMessage(CS.command, { type: MSG.CommandAmf0, streamId: 0, timestamp: 0, payload: amfEncode(name, txn, ...args) }, true);
  }

  private call(name: string, ...args: AmfValue[]): Promise<AmfValue[]> {
    const txn = this.txn++;
    return new Promise<AmfValue[]>((resolve, reject) => {
      this.waiters.set(txn, { resolve, reject });
      this.command(name, txn, ...args);
    });
  }

  private readChunks(data: Uint8Array) {
    this.received += data.length;
    for (const m of this.reader.push(data)) this.handle(m);
    if (this.received - this.lastAck >= this.serverWindow) {
      this.lastAck = this.received;
      this.sendMessage(CS.control, { type: MSG.Ack, streamId: 0, timestamp: 0, payload: u32(this.received >>> 0) }, true);
    }
  }

  private handle(m: RtmpMessage) {
    switch (m.type) {
      case MSG.WindowAckSize:
        if (m.payload.length >= 4) this.serverWindow = Math.max(1, read32(m.payload, 0));
        return;
      case MSG.SetPeerBandwidth:
        if (!this.sentWindow) {
          this.sentWindow = true;
          this.sendMessage(CS.control, { type: MSG.WindowAckSize, streamId: 0, timestamp: 0, payload: u32(ACK_WINDOW) }, true);
        }
        return;
      case MSG.UserControl: {
        if (m.payload.length >= 6 && ((m.payload[0] << 8) | m.payload[1]) === 6) {
          // PingRequest → PingResponse com o mesmo horário
          const pong = new Uint8Array(6);
          pong[1] = 7;
          pong.set(m.payload.subarray(2, 6), 2);
          this.sendMessage(CS.control, { type: MSG.UserControl, streamId: 0, timestamp: 0, payload: pong }, true);
        }
        return;
      }
      case MSG.CommandAmf0:
        this.handleCommand(amfDecode(m.payload));
        return;
      default:
        return;
    }
  }

  private handleCommand(v: AmfValue[]) {
    const [name, txn] = v;
    if (name === '_result' || name === '_error') {
      const w = typeof txn === 'number' ? this.waiters.get(txn) : undefined;
      if (!w) return;
      this.waiters.delete(txn as number);
      if (name === '_result') w.resolve(v);
      else w.reject(new RtmpError(describe(v[3]) || 'O servidor recusou a conexão.', 'recusado'));
      return;
    }
    if (name === 'onStatus') {
      const info = (v[3] ?? {}) as AmfObject;
      const code = String(info.code ?? '');
      const level = String(info.level ?? '');
      if (code === 'NetStream.Publish.Start') {
        this.publishWait?.resolve();
        this.publishWait = null;
        return;
      }
      if (level === 'error' || /Failed|BadName|Rejected|Unpublish/i.test(code)) {
        const msg =
          code === 'NetStream.Publish.BadName'
            ? 'A chave de transmissão já está em uso ou é inválida.'
            : describe(info) || `O servidor recusou a transmissão (${code}).`;
        this.fail(new RtmpError(msg, code || 'recusado'));
      }
      return;
    }
    if (name === 'close' || name === 'onFCUnpublish') {
      if (this.published) this.fail(new RtmpError('O servidor encerrou a transmissão.', 'fechado'));
    }
    // onBWDone, onFCPublish, |RtmpSampleAccess etc.: nada a fazer
  }

  private fail(e: RtmpError, notify = true) {
    if (this.failure || this.stage === 'fechado') return;
    this.failure = e;
    this.rejectAll(e);
    const wasPublished = this.published;
    this.stage = 'fechado';
    try {
      this.t.close();
    } catch {
      /* já fechado */
    }
    if (notify && wasPublished) this.onError(e);
  }

  private rejectAll(e: Error) {
    this.hsDone?.reject(e);
    this.hsDone = null;
    this.publishWait?.reject(e);
    this.publishWait = null;
    for (const w of this.waiters.values()) w.reject(e);
    this.waiters.clear();
  }
}

function describe(v: AmfValue): string {
  if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof EcmaArray)) {
    const d = (v as AmfObject).description;
    if (typeof d === 'string') return d;
  }
  return '';
}
