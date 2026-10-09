// Gera os ícones padrão do app (antes de o admin enviar a logo oficial) e a imagem de compartilhamento.
// Uso: node scripts/make-icons.mjs   (precisa de playwright e sharp instalados)
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const tryReq = (name) => {
  for (const base of [process.cwd(), '/opt/npm-tools']) {
    try {
      return require(require.resolve(name, { paths: [base, `${base}/node_modules`] }));
    } catch {
      /* tenta o próximo */
    }
  }
  throw new Error(`instale ${name}`);
};
const { chromium } = tryReq('playwright');
const sharp = tryReq('sharp');

const root = process.cwd();
const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });
const font = (p) => `data:font/woff2;base64,${readFileSync(resolve(root, 'node_modules', p)).toString('base64')}`;
const fraunces = font('@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2');
const inter = font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');

const css = `
@font-face { font-family: F; src: url(${fraunces}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: I; src: url(${inter}) format('woff2'); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
body { background: transparent; }
.bg { background: radial-gradient(120% 120% at 80% 0%, #2a5bc0 0%, #13306b 42%, #0b1d3f 100%); position: relative; overflow: hidden; }
.dots::after { content: ''; position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.14) 1.4px, transparent 1.8px); background-size: 22px 22px;
  -webkit-mask-image: radial-gradient(60% 60% at 85% 10%, #000, transparent 75%); }
.mark { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; }
.cross { position: relative; }
.cross::before, .cross::after { content: ''; position: absolute; background: linear-gradient(#f2cf86, #d9a54a); border-radius: 3px; }
.word { font-family: F; color: #fff; font-weight: 600; letter-spacing: .06em; line-height: 1; }
`;

function iconHtml(size, scale) {
  // scale = parte do quadrado ocupada pela marca (maskable usa menos)
  const s = size * scale;
  const cw = s * 0.07;
  const ch = s * 0.36;
  return `<html><head><style>${css}
  .cross { width: ${s * 0.26}px; height: ${ch}px; margin-bottom: ${s * 0.06}px; }
  .cross::before { left: 50%; top: 0; width: ${cw}px; height: 100%; transform: translateX(-50%); }
  .cross::after { top: 28%; left: 0; width: 100%; height: ${cw}px; }
  .word { font-size: ${s * 0.34}px; }
  </style></head><body><div class="bg dots" style="width:${size}px;height:${size}px"><div class="mark"><div class="cross"></div><div class="word">IRN</div></div></div></body></html>`;
}

function logoHtml(size) {
  return iconHtml(size, 0.82).replace('class="bg dots" style="', `class="bg dots" style="border-radius:50%;`);
}

function badgeHtml(size) {
  const cw = size * 0.12;
  return `<html><head><style>
  .c { width:${size}px;height:${size}px;position:relative }
  .c::before,.c::after{content:'';position:absolute;background:#fff;border-radius:2px}
  .c::before{left:50%;top:12%;width:${cw}px;height:76%;transform:translateX(-50%)}
  .c::after{top:34%;left:22%;width:56%;height:${cw}px}
  </style></head><body style="margin:0;background:transparent"><div class="c"></div></body></html>`;
}

function ogHtml() {
  return `<html><head><style>${css}
  .og { width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 80px;color:#fff;font-family:I }
  .logo { width:260px;height:260px;border-radius:50%;flex:none;position:relative;box-shadow:0 30px 60px -20px rgba(0,0,0,.6), 0 0 0 6px rgba(255,255,255,.12) }
  .t { font-family:F;font-size:54px;font-weight:560;line-height:1.08;letter-spacing:-.01em }
  .s { margin-top:22px;font-size:27px;opacity:.86;line-height:1.35 }
  .k { font-size:20px;letter-spacing:.14em;text-transform:uppercase;opacity:.75;margin-bottom:18px;font-weight:600 }
  .cross { width: 56px; height: 78px; margin-bottom: 12px; }
  .cross::before { left: 50%; top: 0; width: 15px; height: 100%; transform: translateX(-50%); }
  .cross::after { top: 28%; left: 0; width: 100%; height: 15px; }
  .word { font-size: 64px; }
  </style></head><body><div class="bg dots og">
  <div class="logo bg"><div class="mark"><div class="cross"></div><div class="word">IRN</div></div></div>
  <div><div class="k">App oficial</div><div class="t">Ministério Profético<br/>Restaurando as Nações</div>
  <div class="s">Cultos ao vivo, vídeos, fotos, agenda,<br/>pedidos de oração, dízimos e ofertas.</div></div>
  </div></body></html>`;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function shot(html, w, h, file, transparent = false) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const buf = await page.screenshot({ type: 'png', omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
  writeFileSync(resolve(out, file), buf);
  return buf;
}

const icon1024 = await shot(iconHtml(1024, 0.86), 1024, 1024, 'icon-1024.png');
const mask1024 = await shot(iconHtml(1024, 0.62), 1024, 1024, 'maskable-1024.png');
const logo512 = await shot(logoHtml(512), 512, 512, 'logo.png', true);
await shot(badgeHtml(96), 96, 96, 'badge-96.png', true);
await shot(ogHtml(), 1200, 630, 'og.png');

const resize = (buf, size, file) => sharp(buf).resize(size, size).png({ compressionLevel: 9 }).toFile(resolve(out, file));
await resize(icon1024, 192, 'icon-192.png');
await resize(icon1024, 512, 'icon-512.png');
await resize(icon1024, 180, 'apple-touch-icon.png');
await resize(icon1024, 32, 'favicon-32.png');
await resize(mask1024, 512, 'maskable-512.png');
await sharp(resolve(out, 'badge-96.png')).resize(72, 72).png().toFile(resolve(out, 'badge-72.png'));
await sharp(logo512).resize(256, 256).png({ compressionLevel: 9 }).toFile(resolve(out, 'logo-256.png'));
await browser.close();
console.log('ícones gerados em public/icons');
