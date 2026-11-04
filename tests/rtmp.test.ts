/**
 * Testes do envio de live (RTMP): formato AMF0, chunks, handshake com assinatura, pacotes FLV e uma publicação de
 * verdade num servidor RTMP local (o próprio FFmpeg ouvindo), conferida depois com o ffprobe.
 * Rodar: npx tsx --test tests/rtmp.test.ts   (a parte com FFmpeg é pulada se ele não estiver instalado)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  aacAudioPacket,
  aacConfig,
  aacSequenceHeader,
  amfDecode,
  amfEncode,
  avcSequenceHeader,
  avcVideoPacket,
  buildAvcC,
  c1HashOffset,
  ChunkReader,
  EcmaArray,
  encodeChunks,
  isAnnexB,
  makeC1,
  MSG,
  nalusToAvcc,
  RtmpPublisher,
  splitAnnexB,
  splitRtmpUrl,
  stripAdts,
  type RtmpMessage,
} from '../src/lib/rtmp';

test('AMF0: ida e volta de comandos e metadados', () => {
  const b = amfEncode('connect', 1, { app: 'live2', ok: true, n: 1.5, nada: null, lista: [1, 'dois'] }, undefined);
  const v = amfDecode(b);
  assert.deepEqual(v, ['connect', 1, { app: 'live2', ok: true, n: 1.5, nada: null, lista: [1, 'dois'] }, undefined]);
  // onMetaData vai como ECMA array (0x08) e volta como objeto
  const meta = amfEncode('@setDataFrame', 'onMetaData', new EcmaArray({ width: 1280, height: 720, encoder: 'IRN' }));
  assert.equal(meta[meta.indexOf(0x08, 25)], 0x08);
  assert.deepEqual(amfDecode(meta)[2], { width: 1280, height: 720, encoder: 'IRN' });
  // acentos em UTF-8
  assert.deepEqual(amfDecode(amfEncode('Culto de Domingo — oração')), ['Culto de Domingo — oração']);
});

test('chunks: mensagens grandes, chunk pequeno e timestamp estendido voltam iguais', () => {
  const reader = new ChunkReader();
  const msgs: RtmpMessage[] = [
    { type: MSG.Video, streamId: 1, timestamp: 33, payload: new Uint8Array(10000).map((_, i) => i & 0xff) },
    { type: MSG.Audio, streamId: 1, timestamp: 0x1000000 + 7, payload: new Uint8Array(300).fill(7) },
    { type: MSG.CommandAmf0, streamId: 0, timestamp: 0, payload: amfEncode('_result', 1, null, 5) },
    { type: MSG.Video, streamId: 1, timestamp: 66, payload: new Uint8Array(0) },
  ];
  const bytes = Buffer.concat(msgs.map((m, i) => encodeChunks(3 + i, m, 128)));
  // entrega aos pedaços de 7 bytes, como numa rede lenta
  const got: RtmpMessage[] = [];
  for (let i = 0; i < bytes.length; i += 7) got.push(...reader.push(new Uint8Array(bytes.subarray(i, i + 7))));
  assert.equal(got.length, msgs.length);
  for (const [i, m] of msgs.entries()) {
    assert.equal(got[i].type, m.type);
    assert.equal(got[i].streamId, m.streamId);
    assert.equal(got[i].timestamp, m.timestamp);
    assert.deepEqual(Buffer.from(got[i].payload), Buffer.from(m.payload));
  }
});

test('chunks: o leitor entende cabeçalhos curtos (formatos 1, 2 e 3) e a troca de tamanho do chunk', () => {
  const reader = new ChunkReader();
  // SetChunkSize = 4096, depois uma mensagem de 5000 bytes em 2 chunks; depois outra com formato 2 (só delta)
  const scs = encodeChunks(2, { type: MSG.SetChunkSize, streamId: 0, timestamp: 0, payload: Uint8Array.of(0, 0, 0x10, 0) }, 128);
  const big = encodeChunks(6, { type: MSG.Video, streamId: 1, timestamp: 1000, payload: new Uint8Array(5000).fill(1) }, 4096);
  // formato 2: basic header (0x80|6), delta 40, payload com o mesmo tamanho/tipo da anterior (5000) → 2 chunks
  const f2 = Buffer.concat([Buffer.from([0x80 | 6, 0, 0, 40]), Buffer.alloc(4096, 2), Buffer.from([0xc0 | 6]), Buffer.alloc(904, 2)]);
  // formato 3 iniciando mensagem nova: reaproveita o delta (40)
  const f3 = Buffer.concat([Buffer.from([0xc0 | 6]), Buffer.alloc(4096, 3), Buffer.from([0xc0 | 6]), Buffer.alloc(904, 3)]);
  const out = reader.push(new Uint8Array(Buffer.concat([scs, big, f2, f3])));
  assert.equal(reader.chunkSize, 4096);
  assert.deepEqual(
    out.map((m) => [m.type, m.timestamp, m.payload.length, m.payload[0]]),
    [
      [MSG.SetChunkSize, 0, 4, 0],
      [MSG.Video, 1000, 5000, 1],
      [MSG.Video, 1040, 5000, 2],
      [MSG.Video, 1080, 5000, 3],
    ],
  );
});

test('handshake: a assinatura do C1 confere com o HMAC do FFmpeg/Flash', async () => {
  const c1 = await makeC1();
  assert.equal(c1.length, 1536);
  assert.deepEqual([...c1.subarray(4, 8)], [9, 0, 124, 2]);
  const pos = c1HashOffset(c1);
  const h = createHmac('sha256', 'Genuine Adobe Flash Player 001');
  h.update(c1.subarray(0, pos));
  h.update(c1.subarray(pos + 32));
  assert.deepEqual(Buffer.from(c1.subarray(pos, pos + 32)), h.digest());
});

test('FLV: cabeçalhos de vídeo H.264 e áudio AAC', () => {
  assert.deepEqual([...avcSequenceHeader(Uint8Array.of(1, 2))], [0x17, 0, 0, 0, 0, 1, 2]);
  assert.deepEqual([...avcVideoPacket(Uint8Array.of(9), true, 0x010203)], [0x17, 1, 1, 2, 3, 9]);
  assert.deepEqual([...avcVideoPacket(Uint8Array.of(9), false)], [0x27, 1, 0, 0, 0, 9]);
  assert.deepEqual([...aacSequenceHeader(Uint8Array.of(0x11, 0x90))], [0xaf, 0, 0x11, 0x90]);
  assert.deepEqual([...aacAudioPacket(Uint8Array.of(5))], [0xaf, 1, 5]);
  // AAC-LC 48 kHz estéreo = 0x11 0x90; 44,1 kHz estéreo = 0x12 0x10
  assert.deepEqual([...aacConfig(48000, 2)], [0x11, 0x90]);
  assert.deepEqual([...aacConfig(44100, 2)], [0x12, 0x10]);
  // ADTS (7 bytes, sem CRC) sai
  assert.deepEqual([...stripAdts(Uint8Array.of(0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0xaa, 0xbb))], [0xaa, 0xbb]);
  assert.deepEqual([...stripAdts(Uint8Array.of(0x21, 0x10))], [0x21, 0x10]);
});

test('H.264: Annex B vira AVCC e o avcC é montado do SPS/PPS', () => {
  const sps = Uint8Array.of(0x67, 0x64, 0x00, 0x1f, 0xac);
  const pps = Uint8Array.of(0x68, 0xee, 0x3c);
  const idr = Uint8Array.of(0x65, 0x88, 0x84);
  const annexB = Uint8Array.of(0, 0, 0, 1, ...sps, 0, 0, 1, ...pps, 0, 0, 0, 1, ...idr);
  assert.ok(isAnnexB(annexB));
  const nalus = splitAnnexB(annexB);
  assert.deepEqual(nalus.map((n) => [...n]), [[...sps], [...pps], [...idr]]);
  assert.deepEqual([...nalusToAvcc([idr])], [0, 0, 0, 3, ...idr]);
  assert.deepEqual([...buildAvcC(sps, pps)], [1, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0, 5, ...sps, 1, 0, 3, ...pps]);
});

test('endereço RTMP: app e tcUrl', () => {
  assert.deepEqual(splitRtmpUrl('rtmps://a.rtmps.youtube.com/live2'), { app: 'live2', tcUrl: 'rtmps://a.rtmps.youtube.com/live2' });
  assert.deepEqual(splitRtmpUrl('rtmp://127.0.0.1:19350/live2/'), { app: 'live2', tcUrl: 'rtmp://127.0.0.1:19350/live2' });
  assert.throws(() => splitRtmpUrl('https://youtube.com'));
});

// ---------------- publicação de verdade num servidor RTMP local ----------------

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

interface FlvTag {
  type: number;
  ts: number;
  data: Uint8Array;
}

function readFlv(file: string): FlvTag[] {
  const b = new Uint8Array(readFileSync(file));
  assert.equal(String.fromCharCode(b[0], b[1], b[2]), 'FLV');
  let p = (b[5] << 24) | (b[6] << 16) | (b[7] << 8) | b[8];
  p += 4;
  const tags: FlvTag[] = [];
  while (p + 11 <= b.length) {
    const type = b[p];
    const size = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    const ts = ((b[p + 7] << 24) | (b[p + 4] << 16) | (b[p + 5] << 8) | b[p + 6]) >>> 0;
    tags.push({ type, ts, data: b.subarray(p + 11, p + 11 + size) });
    p += 11 + size + 4;
  }
  return tags;
}

/** Reconstrói cada pacote com as funções do app (em vez de mandar os bytes do arquivo como estão). */
export function rebuild(tag: FlvTag): Uint8Array {
  const d = tag.data;
  if (tag.type === 9) {
    if (d[1] === 0) return avcSequenceHeader(d.subarray(5));
    const cts = (d[2] << 16) | (d[3] << 8) | d[4];
    return avcVideoPacket(d.subarray(5), d[0] >> 4 === 1, cts);
  }
  if (d[1] === 0) return aacSequenceHeader(d.subarray(2));
  return aacAudioPacket(d.subarray(2));
}

test('publicação: o FFmpeg (como servidor RTMP) recebe H.264 + AAC enviados pelo cliente do app', { skip: !hasFfmpeg && 'sem ffmpeg' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'irn-rtmp-'));
  try {
    const input = join(dir, 'entrada.flv');
    const output = join(dir, 'recebido.flv');
    const gen = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '4', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-bf', '0', '-g', '60', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-f', 'flv', input,
    ]);
    assert.equal(gen.status, 0, gen.stderr.toString());
    const tags = readFlv(input).filter((t) => t.type === 8 || t.type === 9);
    assert.ok(tags.length > 200);

    const port = 19350 + Math.floor(Math.random() * 500);
    const server = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'info', '-y',
      '-listen', '1', '-timeout', '20', '-i', `rtmp://127.0.0.1:${port}/live2/chave-de-teste`,
      '-c', 'copy', '-f', 'flv', output,
    ]);
    let serverLog = '';
    server.stderr.on('data', (d) => (serverLog += d));
    const ended = new Promise<number>((resolve) => server.on('exit', (code) => resolve(code ?? -1)));

    // espera o servidor abrir a porta
    let sock: ReturnType<typeof createConnection> | null = null;
    for (let i = 0; i < 50 && !sock; i++) {
      sock = await new Promise((resolve) => {
        const s = createConnection({ host: '127.0.0.1', port }, () => resolve(s));
        s.once('error', () => resolve(null));
      });
      if (!sock) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(sock, 'servidor RTMP local não abriu');

    let sentBytes = 0;
    const pub = new RtmpPublisher(
      {
        send: (data) => {
          sentBytes += data.length;
          sock!.write(data);
        },
        close: () => sock!.end(),
      },
      { url: `rtmp://127.0.0.1:${port}/live2`, key: 'chave-de-teste' },
    );
    sock.on('data', (d) => pub.receive(new Uint8Array(d)));
    sock.on('close', () => pub.transportClosed());
    await pub.publish(10000);
    assert.ok(pub.isPublished);
    pub.sendMetadata({ width: 640, height: 360, framerate: 30, videocodecid: 7, audiocodecid: 10, encoder: 'IRN app (teste)' });
    for (const t of tags) {
      if (t.type === 9) pub.sendVideo(t.ts, rebuild(t));
      else pub.sendAudio(t.ts, rebuild(t));
    }
    pub.close();
    const code = await ended;
    assert.equal(code, 0, serverLog.slice(-2000));
    assert.ok(sentBytes > 100_000);

    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=codec_name,width,height,sample_rate,channels:format=duration', '-of', 'json', output,
    ]);
    const info = JSON.parse(probe.stdout.toString()) as {
      streams: { codec_name: string; width?: number; height?: number; sample_rate?: string; channels?: number }[];
      format: { duration: string };
    };
    const v = info.streams.find((s) => s.codec_name === 'h264');
    const a = info.streams.find((s) => s.codec_name === 'aac');
    assert.ok(v, 'sem vídeo H.264 no recebido');
    assert.ok(a, 'sem áudio AAC no recebido');
    assert.equal(v!.width, 640);
    assert.equal(a!.sample_rate, '48000');
    assert.equal(a!.channels, 2);
    assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.5, `duração ${info.format.duration}`);
    // os quadros de vídeo chegaram inteiros (decodifica tudo sem erro)
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
    assert.equal(decode.stderr.toString().trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
