/**
 * Ponte da live: o celular manda os bytes da transmissão (protocolo RTMP) por um WebSocket e este Durable Object
 * repassa para o servidor de entrada do YouTube por uma conexão TCP com criptografia (RTMPS, porta 443) — e o
 * que o YouTube responde volta pelo mesmo caminho. Não converte nem guarda vídeo: só repassa os bytes.
 *
 * Só o servidor do app decide para onde a ponte liga (cabeçalhos x-relay-*, montados na rota /api/live/relay a
 * partir da conta do YouTube da pessoa). O celular não consegue escolher outro destino.
 * Plano grátis da Cloudflare: Durable Objects com SQLite são liberados (este não grava nada).
 */
import { DurableObject } from 'cloudflare:workers';
import { connect } from 'cloudflare:sockets';
import type { Env } from './types';

const MAX_MS = 6 * 3600_000;
const MAX_QUEUE = 24 * 1024 * 1024;
const SEEN_EVERY = 60_000;

export class LiveRelay extends DurableObject<Env> {
  private current: { ws: WebSocket; close: (why: string, code?: number) => void } | null = null;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('esperava websocket', { status: 426 });
    const host = req.headers.get('x-relay-host') ?? '';
    const port = Number(req.headers.get('x-relay-port'));
    const tls = req.headers.get('x-relay-tls') === '1';
    const sessionId = Number(req.headers.get('x-relay-session')) || 0;
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return new Response('destino inválido', { status: 400 });

    // Uma live tem uma conexão só: se o celular reconectou, a conexão antiga sai.
    this.current?.close('Outra conexão assumiu esta live.', 4000);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    // Pelo padrão atual, mensagens binárias chegam como Blob; ArrayBuffer evita uma cópia (e o Blob também é tratado).
    try {
      (server as unknown as { binaryType: string }).binaryType = 'arraybuffer';
    } catch {
      /* versão sem binaryType: os Blobs são lidos abaixo */
    }
    this.ctx.waitUntil(this.bridge(server, host, port, tls, sessionId));
    return new Response(null, { status: 101, webSocket: client });
  }

  private async bridge(ws: WebSocket, host: string, port: number, tls: boolean, sessionId: number) {
    let socket: Socket | null = null;
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    let done = false;
    let queued = 0;
    let chain: Promise<unknown> = Promise.resolve();
    let lastSeen = 0;
    const early: (Uint8Array | Promise<Uint8Array>)[] = [];

    const close = (why: string, code = 1000) => {
      if (done) return;
      done = true;
      clearTimeout(limit);
      if (this.current?.ws === ws) this.current = null;
      try {
        ws.send(JSON.stringify({ t: 'fim', m: why }));
      } catch {
        /* já fechado */
      }
      try {
        ws.close(code, why.slice(0, 100));
      } catch {
        /* já fechado */
      }
      try {
        socket?.close();
      } catch {
        /* já fechado */
      }
    };
    this.current = { ws, close };
    const limit = setTimeout(() => close('A live passou de 6 horas e a conexão foi encerrada.'), MAX_MS);

    /** Repassa ao YouTube na mesma ordem em que chegou (um Blob precisa ser lido antes, por isso a fila). */
    const forward = (data: Uint8Array | Promise<Uint8Array>, size: number) => {
      queued += size;
      if (queued > MAX_QUEUE) {
        close('A conexão até o YouTube ficou lenta demais.', 1011);
        return;
      }
      const w = writer!;
      chain = chain
        .then(async () => {
          if (!done) await w.write(await data);
        })
        .then(
          () => {
            queued -= size;
          },
          () => close('A conexão com o YouTube caiu.', 1011),
        );
    };

    ws.addEventListener('message', (ev) => {
      if (done) return;
      const raw = ev.data as unknown;
      if (typeof raw === 'string') {
        if (raw === 'ping') ws.send('pong');
        return;
      }
      let data: Uint8Array | Promise<Uint8Array>;
      let size: number;
      if (raw instanceof ArrayBuffer) {
        data = new Uint8Array(raw);
        size = raw.byteLength;
      } else if (ArrayBuffer.isView(raw)) {
        data = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        size = raw.byteLength;
      } else if (raw instanceof Blob) {
        data = raw.arrayBuffer().then((b) => new Uint8Array(b));
        size = raw.size;
      } else {
        return;
      }
      if (!writer) {
        early.push(data);
        queued += size;
        return;
      }
      forward(data, size);
      const t = Date.now();
      if (sessionId && t - lastSeen > SEEN_EVERY) {
        lastSeen = t;
        this.ctx.waitUntil(
          this.env.DB.prepare('UPDATE live_sessions SET relay_seen_at = ? WHERE id = ?')
            .bind(t, sessionId)
            .run()
            .catch(() => undefined),
        );
      }
    });
    ws.addEventListener('close', () => close('O app fechou a conexão.'));
    ws.addEventListener('error', () => close('Erro na conexão com o app.', 1011));

    try {
      socket = connect({ hostname: host, port }, { secureTransport: tls ? 'on' : 'off', allowHalfOpen: false });
      await socket.opened;
    } catch (e) {
      console.error('relay: conexão com o servidor de entrada falhou', host, port, String(e));
      close('Não consegui conectar ao servidor do YouTube. Tente de novo.', 1011);
      return;
    }
    if (done) {
      socket.close();
      return;
    }
    writer = socket.writable.getWriter();
    const pendingEarly = early.splice(0);
    queued = 0;
    for (const d of pendingEarly) forward(d, d instanceof Uint8Array ? d.byteLength : 0);
    ws.send(JSON.stringify({ t: 'aberto' }));

    // YouTube → celular
    try {
      const reader = socket.readable.getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end || done) break;
        if (value && value.byteLength) ws.send(value);
      }
    } catch {
      /* conexão caiu */
    }
    close('O servidor do YouTube fechou a conexão.');
  }
}
