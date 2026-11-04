// Teste de ponta a ponta da live pela câmera do app:
// celular simulado (câmera de mentira do Chromium) → tela Transmitir → WebSocket → ponte (Durable Object no
// wrangler dev) → servidor RTMP local (o FFmpeg ouvindo) — e o YouTube de mentira (tests/fake-google.mjs).
// No fim confere com o ffprobe que chegou vídeo H.264 + áudio AAC.
//
// Uso (sobe tudo e desliga no fim; troque o IP pelo da sua máquina na rede — o wrangler dev não deixa abrir TCP
// para 127.0.0.1):
//   FAKE_RTMP=rtmp://192.168.0.10:19360/live2 FAKE_RTMP_OUT=$PWD/tests/.out/live-recebida.flv \
//   E2E=tests/live-e2e.mjs ./tests/run-e2e.sh
//
// O Chromium de Linux não tem codificador AAC; o teste troca só o AudioEncoder por um que devolve quadros AAC de
// verdade gerados pelo FFmpeg (o resto — câmera, H.264, RTMP, WebSocket, ponte — é o código do app).
import { createRequire } from 'node:module';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
for (const p of [process.cwd(), '/opt/npm-tools', execSync('npm root -g').toString().trim()]) {
  try {
    playwright = require(require.resolve('playwright', { paths: [p, `${p}/node_modules`] }));
    break;
  } catch {
    /* próximo */
  }
}
const { chromium } = playwright;
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const GOOGLE = 'http://127.0.0.1:9555';
const OUT = resolve(process.cwd(), 'tests/.out');
const RECEIVED = process.env.FAKE_RTMP_OUT || resolve(OUT, 'live-recebida.flv');
mkdirSync(OUT, { recursive: true });
rmSync(RECEIVED, { force: true });

const failures = [];
const errors = [];
let step = 0;
const log = (...a) => console.log(`[${String(++step).padStart(2, '0')}]`, ...a);
const pages = [];
async function check(name, fn) {
  try {
    await fn();
    log('ok   ', name);
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    log('FALHA', name, '-', e.message.split('\n')[0]);
    for (const [i, p] of pages.entries()) await p.screenshot({ path: resolve(OUT, `live-falha-${step}-${i}.png`) }).catch(() => undefined);
  }
}

// ---------- quadros AAC de verdade (o Chromium de Linux não codifica AAC) ----------
const aacFile = resolve(OUT, 'tom.aac');
const gen = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-ac', '2', '-t', '30', '-c:a', 'aac', '-b:a', '128k', '-f', 'adts', aacFile]);
if (gen.status !== 0) throw new Error(`ffmpeg não gerou o áudio de teste: ${gen.stderr}`);
const adts = readFileSync(aacFile);
const frames = [];
for (let p = 0; p + 7 < adts.length; ) {
  const len = ((adts[p + 3] & 0x03) << 11) | (adts[p + 4] << 3) | (adts[p + 5] >> 5);
  const head = adts[p + 1] & 0x01 ? 7 : 9;
  frames.push(adts.subarray(p + head, p + len).toString('base64'));
  p += len;
}

// ---------- servidor RTMP local (no lugar do YouTube) ----------
// O wrangler dev não deixa o Worker abrir conexão TCP para 127.0.0.1: o servidor fica no IP da máquina na rede.
const RTMP_HOST = (process.env.FAKE_RTMP || 'rtmp://127.0.0.1:19360/live2').replace(/^rtmp:\/\/([^:/]+).*$/, '$1');
const rtmp = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'info', '-y', '-listen', '1', '-timeout', '180', '-i', `rtmp://${RTMP_HOST}:19360/live2/chave-teste-e2e`, '-c', 'copy', '-f', 'flv', RECEIVED]);
let rtmpLog = '';
rtmp.stderr.on('data', (d) => (rtmpLog += d));
const rtmpEnded = new Promise((r) => rtmp.on('exit', (code) => r(code)));

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});

async function newPhone(name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'],
  });
  await context.addInitScript((list) => {
    const bytes = list.map((b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0)));
    const Real = window.AudioEncoder;
    class FakeAacEncoder {
      constructor(init) {
        this.init = init;
        this.state = 'unconfigured';
        this.encodeQueueSize = 0;
        this.i = 0;
      }
      static async isConfigSupported(cfg) {
        if (cfg.codec === 'mp4a.40.2') return { supported: [44100, 48000].includes(cfg.sampleRate), config: cfg };
        return Real.isConfigSupported(cfg);
      }
      configure(cfg) {
        this.cfg = cfg;
        this.state = 'configured';
        this.first = true;
      }
      encode(data) {
        const chunk = new EncodedAudioChunk({ type: 'key', timestamp: data.timestamp, data: bytes[this.i++ % bytes.length] });
        const meta = this.first
          ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: this.cfg.sampleRate, numberOfChannels: 2, description: new Uint8Array([0x11, 0x90]) } }
          : undefined;
        this.first = false;
        queueMicrotask(() => this.init.output(chunk, meta));
      }
      flush() {
        return Promise.resolve();
      }
      reset() {}
      close() {
        this.state = 'closed';
      }
    }
    window.AudioEncoder = FakeAacEncoder;
  }, frames);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/youtube|ytimg|ggpht|google\.com|ERR_|net::|Failed to load resource|CSP|frame|permissions policy/i.test(t)) return;
    errors.push(`[${name}] ${t}`);
  });
  page.on('pageerror', (e) => errors.push(`[${name}] erro na página: ${e.message}`));
  page.setDefaultTimeout(30000);
  pages.push(page);
  return page;
}

async function devLogin(page, email, name, role) {
  await page.goto(`${BASE}/privacidade`);
  const r = await page.request.post(`${BASE}/api/auth/dev`, {
    headers: { 'x-irn': '1', 'content-type': 'application/json' },
    data: { email, name, ...(role ? { role, status: 'aprovado' } : {}) },
  });
  if (!r.ok()) throw new Error(`login de teste falhou: ${r.status()}`);
}
const toast = (page, text) => page.locator('.toast', { hasText: text }).first().waitFor();
// fetch de dentro da página (leva o cookie de sessão, que é "Secure")
const apiGet = (page, path) => page.evaluate((p) => fetch(p, { credentials: 'same-origin' }).then((r) => r.json()), path);
const confirm = async (page, label) => page.locator('.sheet').getByRole('button', { name: label, exact: true }).click();
const shot = (page, file) => page.screenshot({ path: resolve(OUT, file) });
const ytState = async () => (await fetch(`${GOOGLE}/youtube/v3/_estado`)).json();

// O primeiro login vira administrador: entra o admin antes, para o teste usar um membro comum.
const admin = await newPhone('admin');
await devLogin(admin, 'bispo@irn.test', 'Ronaldo Nogueira');

const m = await newPhone('membro');
await check('membro comum vê "Fazer uma live" na tela Ao vivo', async () => {
  await devLogin(m, 'maria@irn.test', 'Maria Membro', 'membro');
  await m.goto(`${BASE}/ao-vivo`);
  await m.getByText('Fazer uma live').waitFor();
  await m.getByRole('link', { name: 'Transmitir pelo celular' }).click();
  await m.waitForURL('**/ao-vivo/transmitir');
  await m.getByText('Conecte o seu YouTube').waitFor();
  await shot(m, 'live-01-conectar.png');
});

await check('conecta o YouTube da própria conta Google (OAuth com permissão do YouTube)', async () => {
  await m.getByRole('link', { name: 'Conectar minha conta do YouTube' }).click();
  await toast(m, 'YouTube conectado!');
  await m.getByText('Canal do Fernando (teste)').waitFor();
  await m.waitForSelector('.broadcast-stage video');
  await m.waitForFunction(() => {
    const v = document.querySelector('.broadcast-stage video');
    return v && v.videoWidth > 0;
  });
  await shot(m, 'live-02-pronto.png');
});

await check('conta sem live liberada no YouTube: mostra o passo a passo de ativação', async () => {
  await fetch(`${GOOGLE}/youtube/v3/_falhar?reason=liveStreamingNotEnabled`);
  await m.getByRole('button', { name: 'Começar a live' }).click();
  await m.getByText('Ative a live no seu YouTube (só uma vez)').waitFor();
  await m.getByText('não precisa de 50 inscritos').waitFor();
  await shot(m, 'live-03-ativar.png');
});

let broadcastId = '';
await check('começa a live pela câmera: o vídeo chega ao servidor RTMP e a live entra no ar no app', async () => {
  await m.getByRole('button', { name: 'Já ativei, tentar de novo' }).click();
  await toast(m, 'Você está ao vivo');
  await m.locator('.broadcast-stage .badge.live').waitFor();
  const live = await apiGet(m, '/api/live');
  broadcastId = live.youtube_id;
  if (!live.active || !live.mine || !live.can_end) throw new Error(`live no app: ${JSON.stringify(live)}`);
  const st = await ytState();
  const b = st.broadcasts.find((x) => x.id === broadcastId);
  if (!b || b.life !== 'live' || !b.contentDetails.enableAutoStart || b.contentDetails.enableAutoStop) throw new Error(`no YouTube: ${JSON.stringify(b)}`);
  await shot(m, 'live-04-ao-vivo.png');
});

const v = await newPhone('visitante');
await check('quem não está logado vê a live no ar na tela Ao vivo', async () => {
  await v.goto(`${BASE}/ao-vivo`);
  await v.locator('.badge.live').first().waitFor();
  await v.getByRole('heading', { name: 'Culto de' }).first().waitFor();
});

await check('a transmissão continua por alguns segundos (vídeo e áudio indo)', async () => {
  await m.waitForTimeout(9000);
  const kbps = await m.locator('.broadcast-stage .overlay .badge').nth(1).textContent();
  if (!/kbps/.test(kbps ?? '')) throw new Error(`sem taxa de envio: ${kbps}`);
  await shot(m, 'live-05-transmitindo.png');
});

await check('encerra a live: termina no YouTube e sai do app', async () => {
  await m.getByRole('button', { name: 'Encerrar live' }).click();
  await confirm(m, 'Encerrar');
  await toast(m, 'Live encerrada.');
  const live = await apiGet(m, '/api/live');
  if (live.active) throw new Error('a live continua ativa no app');
  const st = await ytState();
  const b = st.broadcasts.find((x) => x.id === broadcastId);
  if (!b || b.life !== 'complete' || !b.transitions.includes('complete')) throw new Error(`no YouTube: ${JSON.stringify(b)}`);
});

await check('o servidor RTMP recebeu vídeo H.264 e áudio AAC inteiros', async () => {
  const code = await Promise.race([rtmpEnded, new Promise((r) => setTimeout(() => r('tempo'), 20000))]);
  if (code !== 0) throw new Error(`ffmpeg terminou com ${code}: ${rtmpLog.slice(-1500)}`);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,sample_rate,channels:format=duration', '-of', 'json', RECEIVED]);
  const info = JSON.parse(probe.stdout.toString());
  const vs = info.streams.find((s) => s.codec_name === 'h264');
  const as = info.streams.find((s) => s.codec_name === 'aac');
  if (!vs || !as) throw new Error(`faltou vídeo ou áudio: ${JSON.stringify(info.streams)}`);
  if (vs.width !== 1280 || vs.height !== 720) throw new Error(`resolução ${vs.width}x${vs.height}`);
  const dur = Number(info.format.duration);
  if (!(dur > 8)) throw new Error(`duração curta: ${dur}`);
  const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', RECEIVED, '-f', 'null', '-']);
  const decErr = dec.stderr.toString().trim();
  if (decErr) throw new Error(`erros ao decodificar: ${decErr.slice(0, 500)}`);
  log('     recebido:', `${vs.width}x${vs.height}`, `${dur.toFixed(1)} s`, `áudio ${as.sample_rate} Hz/${as.channels} canais`);
});
// Daqui para a frente o YouTube de mentira deve ver o sinal "parado" (nada chegando).
rmSync(RECEIVED, { force: true });

await check('modo "Outro app (Larix)": cria a live e mostra a chave e o atalho do Larix', async () => {
  await m.goto(`${BASE}/ao-vivo/transmitir`);
  await m.getByRole('tab', { name: 'Outro app (Larix)' }).click();
  await m.getByRole('button', { name: 'Criar a live e mostrar a chave' }).click();
  const larix = m.getByRole('link', { name: 'Abrir no Larix já configurado' });
  await larix.waitFor();
  const href = await larix.getAttribute('href');
  if (!href.startsWith(`larix://set/v1?conn[][url]=${encodeURIComponent(`rtmp://${RTMP_HOST}:19360/live2/chave-teste-e2e`)}`)) throw new Error(`atalho do Larix: ${href}`);
  await m.getByText('••••••••').waitFor();
  await m.getByRole('button', { name: 'Mostrar' }).click();
  await m.getByText(`rtmp://${RTMP_HOST}:19360/live2/chave-teste-e2e`).waitFor();
  await shot(m, 'live-06-larix.png');
  await m.getByRole('button', { name: 'Cancelar esta live' }).click();
  await confirm(m, 'Cancelar live');
  await toast(m, 'Live cancelada.');
  const st = await ytState();
  const last = st.broadcasts.at(-1);
  if (last.life !== 'apagada') throw new Error(`a live cancelada não foi apagada do YouTube: ${last.life}`);
});

await check('desconecta o YouTube', async () => {
  await m.getByRole('button', { name: /desconectar/ }).click();
  await confirm(m, 'Desconectar');
  await toast(m, 'YouTube desconectado.');
  await m.getByText('Conecte o seu YouTube').waitFor();
});

await check('visitante não consegue abrir a ponte da live', async () => {
  const r = await v.request.post(`${BASE}/api/live/youtube/preparar`, { headers: { 'x-irn': '1', 'content-type': 'application/json' }, data: {} });
  if (r.status() !== 401) throw new Error(`esperava 401, veio ${r.status()}`);
});

await browser.close();
rtmp.kill('SIGKILL');
if (errors.length) {
  console.log('\nErros no console:');
  for (const e of errors) console.log(' -', e);
}
console.log(failures.length ? `\n${failures.length} FALHA(S):\n - ${failures.join('\n - ')}` : '\nLive pela câmera do app: tudo certo.');
process.exit(failures.length || errors.length ? 1 : 0);
