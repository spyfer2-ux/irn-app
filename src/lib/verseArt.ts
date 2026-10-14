/** Arte de versículo (imagem para WhatsApp/Instagram) desenhada no próprio aparelho, com a logo da igreja. */

export type ArtFormat = 'post' | 'story';
export type ArtTheme = 'noite' | 'dourado' | 'aurora' | 'mata' | 'claro';

export const ART_THEMES: { id: ArtTheme; label: string; bg: [string, string]; ink: string; accent: string }[] = [
  { id: 'noite', label: 'Noite', bg: ['#0b1d3f', '#1d4596'], ink: '#ffffff', accent: '#e8c47e' },
  { id: 'dourado', label: 'Dourado', bg: ['#6e4a10', '#d9a54a'], ink: '#ffffff', accent: '#fff1cf' },
  { id: 'aurora', label: 'Aurora', bg: ['#33195a', '#c2577a'], ink: '#ffffff', accent: '#ffd9a8' },
  { id: 'mata', label: 'Mata', bg: ['#0e3a31', '#2f7d63'], ink: '#ffffff', accent: '#d8f0c2' },
  { id: 'claro', label: 'Claro', bg: ['#fffaf0', '#efe1c2'], ink: '#1b2440', accent: '#9a6a17' },
];

export const ART_SIZES: Record<ArtFormat, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: 'Post (4:5)' },
  story: { w: 1080, h: 1920, label: 'Status / Stories' },
};

const SERIF = '"Fraunces Variable", Fraunces, Georgia, "Times New Roman", serif';
const SANS = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

let logoPromise: Promise<HTMLImageElement | null> | null = null;
function loadLogo(): Promise<HTMLImageElement | null> {
  if (!logoPromise)
    logoPromise = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        logoPromise = null;
        resolve(null);
      };
      img.src = '/api/brand/logo';
    });
  return logoPromise;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export interface ArtInput {
  text: string;
  reference: string;
  church: string;
  theme: ArtTheme;
  format: ArtFormat;
}

export async function drawVerseArt(input: ArtInput): Promise<Blob> {
  const { w, h } = ART_SIZES[input.format];
  const theme = ART_THEMES.find((t) => t.id === input.theme) ?? ART_THEMES[0];
  try {
    await Promise.all([document.fonts.load(`500 60px ${SERIF}`), document.fonts.load(`700 40px ${SANS}`)]);
  } catch {
    /* usa a fonte padrão */
  }
  const logo = await loadLogo();

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Fundo
  const g = ctx.createLinearGradient(0, 0, w * 0.6, h);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Brilho suave
  const r = ctx.createRadialGradient(w * 0.8, h * 0.12, 0, w * 0.8, h * 0.12, w * 0.9);
  r.addColorStop(0, 'rgba(255,255,255,0.18)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, w, h);
  // Moldura fina
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, w - 88, h - 88);
  ctx.globalAlpha = 1;

  const pad = 120;
  let top = input.format === 'story' ? 210 : 120;

  // Logo num círculo claro (fica boa sobre qualquer fundo)
  if (logo) {
    const R = 78;
    const cx = w / 2;
    const cy = top + R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 24;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 8, 0, Math.PI * 2);
    ctx.clip();
    const s = Math.min(((R - 14) * 2) / logo.width, ((R - 14) * 2) / logo.height);
    const lw = logo.width * s;
    const lh = logo.height * s;
    ctx.drawImage(logo, cx - lw / 2, cy - lh / 2, lw, lh);
    ctx.restore();
    top = cy + R + 40;
  }

  const bottomReserve = input.format === 'story' ? 300 : 170;
  const refSize = 42;
  const areaH = h - top - bottomReserve - refSize - 60;
  const maxW = w - pad * 2;

  // Texto: diminui a letra até caber
  const body = `“${input.text.trim()}”`;
  let size = input.format === 'story' ? 74 : 68;
  let lines: string[] = [];
  let lineH = 0;
  for (; size >= 26; size -= 2) {
    ctx.font = `500 ${size}px ${SERIF}`;
    lines = wrap(ctx, body, maxW);
    lineH = size * 1.36;
    if (lines.length * lineH <= areaH) break;
  }
  if (lines.length * lineH > areaH) {
    const max = Math.max(1, Math.floor(areaH / lineH));
    lines = lines.slice(0, max);
    lines[max - 1] = `${lines[max - 1].replace(/[\s,.;:!?”"]+$/, '')}…”`;
  }
  const blockH = lines.length * lineH + 40 + refSize;
  let y = top + Math.max(0, (areaH + 60 + refSize - blockH) / 2);

  ctx.fillStyle = theme.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = `500 ${size}px ${SERIF}`;
  for (const line of lines) {
    ctx.fillText(line, w / 2, y);
    y += lineH;
  }

  // Referência
  y += 40;
  ctx.fillStyle = theme.accent;
  ctx.font = `700 ${refSize}px ${SANS}`;
  ctx.fillText(input.reference, w / 2, y);

  // Rodapé
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = theme.ink;
  ctx.font = `600 28px ${SANS}`;
  const foot = input.church.length > 46 ? `${input.church.slice(0, 45)}…` : input.church;
  ctx.fillText(foot, w / 2, h - bottomReserve + (input.format === 'story' ? 150 : 70));
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não consegui gerar a imagem.'))), 'image/png'));
}

/** Compartilha a imagem (WhatsApp, Instagram…) ou, se o aparelho não deixar, baixa o arquivo. */
export async function shareImage(blob: Blob, filename: string, text: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'shared';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
