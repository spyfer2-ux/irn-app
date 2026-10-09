// Teste com o armazenamento R2 ligado: fotos no R2, envio de vídeo em partes, capa automática e reprodução com "Range".
// Uso: WRANGLER_ARGS="-c tests/wrangler.r2.jsonc" E2E=tests/e2e-r2.mjs ./tests/run-e2e.sh
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve('playwright', { paths: ['/opt/npm-tools/node_modules', process.cwd()] }));
const BASE = 'http://127.0.0.1:8787';
const OUT = resolve(process.cwd(), 'tests/.out');
const FIX = resolve(process.cwd(), 'tests/fixtures');
mkdirSync(OUT, { recursive: true });
const failures = [];
const errors = [];
let n = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`[${++n}] ok    ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message.split('\n')[0]}`);
    console.log(`[${++n}] FALHA ${name} - ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: resolve(OUT, `r2-falha-${n}.png`) }).catch(() => undefined);
  }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
page.on('console', (m) => m.type() === 'error' && !/youtube|ytimg|ERR_|Failed to load|net::/i.test(m.text()) && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

await page.goto(BASE + '/privacidade');
await page.request.post(BASE + '/api/auth/dev', { headers: { 'x-irn': '1', 'content-type': 'application/json' }, data: { email: 'midia@irn.test', name: 'Equipe Mídia' } });

await check('R2 ligado e envio de vídeo liberado', async () => {
  await page.goto(BASE + '/');
  const boot = await page.evaluate(() => fetch('/api/boot').then((r) => r.json()));
  if (boot.features.storage !== 'r2' || !boot.features.video_upload) throw new Error(JSON.stringify(boot.features));
});

await check('foto vai para o R2 e volta igual', async () => {
  await page.goto(BASE + '/fotos');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await page.locator('input[type=file][multiple]').setInputFiles([resolve(FIX, 'foto1.jpg'), resolve(FIX, 'foto2.jpg')]);
  await page.getByRole('switch', { name: /concordam/ }).check();
  await page.getByRole('button', { name: 'Enviar 2 fotos' }).click();
  await page.getByRole('button', { name: /Pronto! 2 fotos enviadas/ }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /Pronto!/ }).click();
  const info = await page.evaluate(async () => {
    const r = await fetch('/api/fotos?album=todas').then((x) => x.json());
    const id = r.photos[0].media_id;
    const res = await fetch(`/api/media/${id}`);
    return { status: res.status, type: res.headers.get('content-type'), size: (await res.arrayBuffer()).byteLength };
  });
  if (info.status !== 200 || info.type !== 'image/jpeg' || info.size < 20000) throw new Error(JSON.stringify(info));
});

// vídeo de verdade (gravado no navegador) para testar a capa automática e a reprodução
const webm = await page.evaluate(async () => {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(25);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(200);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      ctx.fillStyle = `hsl(${(t * 90) % 360} 60% 35%)`;
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 48px sans-serif';
      ctx.fillText('IRN — teste de vídeo', 60, 190);
      if (t < 2.5) requestAnimationFrame(draw);
      else resolve();
    };
    draw();
  });
  rec.stop();
  await new Promise((r) => (rec.onstop = r));
  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
});

await check('envia vídeo curto (com capa automática)', async () => {
  await page.goto(BASE + '/videos');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Enviar do celular' }).click();
  await page.locator('input[type=file][accept*=video]').setInputFiles({ name: 'testemunho.webm', mimeType: 'video/webm', buffer: Buffer.from(webm, 'base64') });
  await page.getByLabel('Título', { exact: true }).fill('Testemunho da irmã Maria');
  await page.getByRole('button', { name: 'Enviar vídeo' }).click();
  await page.waitForURL(/\/videos\/\d+$/, { timeout: 60000 });
  const v = page.locator('.player video');
  await v.waitFor();
  const poster = await v.getAttribute('poster');
  if (!poster) throw new Error('vídeo sem capa');
  await page.waitForFunction(() => {
    const el = document.querySelector('.player video');
    return el && el.readyState >= 1 && el.duration > 1;
  });
  await page.screenshot({ path: resolve(OUT, 'r2-video.png') });
});

await check('vídeo grande vai em 3 partes e o servidor responde a pedaços (Range)', async () => {
  const big = randomBytes(18 * 1024 * 1024);
  await page.goto(BASE + '/videos');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await page.getByRole('button', { name: 'Enviar do celular' }).click();
  await page.locator('input[type=file][accept*=video]').setInputFiles({ name: 'culto.mp4', mimeType: 'video/mp4', buffer: big });
  await page.getByLabel('Título', { exact: true }).fill('Arquivo grande de teste');
  await page.getByRole('switch', { name: 'Público' }).uncheck();
  await page.getByRole('button', { name: 'Enviar vídeo' }).click();
  await page.waitForURL(/\/videos\/\d+$/, { timeout: 120000 });
  const id = page.url().split('/').pop();
  const r = await page.evaluate(async (vid) => {
    const v = await fetch(`/api/videos/${vid}`).then((x) => x.json());
    const url = `/api/media/${v.video.media_id}`;
    const part = await fetch(url, { headers: { range: 'bytes=100-199' } });
    const tail = await fetch(url, { headers: { range: 'bytes=-10' } });
    const full = await fetch(url, { method: 'HEAD' });
    return {
      status: part.status,
      range: part.headers.get('content-range'),
      len: (await part.arrayBuffer()).byteLength,
      tailStatus: tail.status,
      tailRange: tail.headers.get('content-range'),
      size: full.headers.get('content-length'),
      visibility: v.video.visibility,
    };
  }, id);
  const total = 18 * 1024 * 1024;
  if (r.status !== 206 || r.range !== `bytes 100-199/${total}` || r.len !== 100) throw new Error(JSON.stringify(r));
  if (r.tailStatus !== 206 || r.tailRange !== `bytes ${total - 10}-${total - 1}/${total}`) throw new Error(JSON.stringify(r));
  if (Number(r.size) !== total || r.visibility !== 'members') throw new Error(JSON.stringify(r));
});

await check('vídeo só para membros não abre para visitante', async () => {
  const visitor = await browser.newContext();
  const vp = await visitor.newPage();
  const list = await page.evaluate(() => fetch('/api/videos?fonte=upload').then((r) => r.json()));
  const members = list.videos.find((v) => v.visibility === 'members');
  const res = await vp.request.get(`${BASE}/api/media/${members.media_id}`);
  if (res.status() !== 401) throw new Error(`esperava 401, veio ${res.status()}`);
  await visitor.close();
});

await check('apagar vídeo apaga o arquivo', async () => {
  const list = await page.evaluate(() => fetch('/api/videos?fonte=upload').then((r) => r.json()));
  const big = list.videos.find((v) => v.title === 'Arquivo grande de teste');
  await page.goto(`${BASE}/videos/${big.id}`);
  await page.getByRole('button', { name: 'Apagar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Apagar' }).click();
  await page.waitForURL(/\/videos$/);
  const st = await page.evaluate((m) => fetch(`/api/media/${m}`).then((r) => r.status), big.media_id);
  if (st !== 404) throw new Error(`arquivo ainda existe (${st})`);
});

await browser.close();
console.log(`\nFalhas: ${failures.length}`);
failures.forEach((f) => console.log(' -', f));
console.log(`Erros no console: ${errors.length}`);
errors.forEach((e) => console.log(' -', e));
process.exit(failures.length || errors.length ? 1 : 0);
