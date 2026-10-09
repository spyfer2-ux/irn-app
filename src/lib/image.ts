/** Reduz fotos no próprio celular antes de enviar: economiza internet e espaço. */

type Source = ImageBitmap | HTMLImageElement;

async function load(file: Blob): Promise<Source> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error('Não consegui abrir esta imagem. Envie em JPG ou PNG.');
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }
}

function size(src: Source) {
  return 'naturalWidth' in src ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha ao preparar a imagem.'))), type, quality),
  );
}

export interface Resized {
  blob: Blob;
  width: number;
  height: number;
}

async function render(src: Source, maxSide: number, maxBytes: number, type = 'image/jpeg', fill?: string): Promise<Resized> {
  const { w, h } = size(src);
  let scale = Math.min(1, maxSide / Math.max(w, h));
  let quality = 0.86;
  for (let attempt = 0; attempt < 7; attempt++) {
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    if (fill || type === 'image/jpeg') {
      ctx.fillStyle = fill ?? '#ffffff';
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
    const blob = await toBlob(canvas, type, quality);
    if (blob.size <= maxBytes || attempt === 6) return { blob, width: cw, height: ch };
    if (quality > 0.66) quality -= 0.1;
    else scale *= 0.8;
  }
  throw new Error('Falha ao preparar a imagem.');
}

export async function preparePhoto(file: Blob, storage: 'r2' | 'd1') {
  const src = await load(file);
  const full = await render(src, storage === 'r2' ? 2048 : 1600, storage === 'r2' ? 3_500_000 : 1_400_000);
  const thumb = await render(src, 480, 160_000);
  if ('close' in src) src.close();
  return { full, thumb };
}

/** Capa de evento, aviso, campanha etc. */
export async function prepareCover(file: Blob, storage: 'r2' | 'd1') {
  const src = await load(file);
  const out = await render(src, storage === 'r2' ? 1600 : 1280, storage === 'r2' ? 1_500_000 : 700_000);
  if ('close' in src) src.close();
  return out;
}

export async function prepareReceipt(file: Blob) {
  const src = await load(file);
  const out = await render(src, 1400, 900_000);
  if ('close' in src) src.close();
  return out;
}

/** Ícones do app a partir da logo: quadrados, com fundo azul-marinho. */
export async function prepareIcons(file: Blob) {
  const src = await load(file);
  const { w, h } = size(src);
  const make = async (px: number, padding: number, round: boolean) => {
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0b1d3f';
    ctx.fillRect(0, 0, px, px);
    const inner = px * (1 - padding * 2);
    const s = Math.min(inner / w, inner / h);
    const dw = w * s;
    const dh = h * s;
    if (round) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(px / 2, px / 2, inner / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, (px - dw) / 2, (px - dh) / 2, dw, dh);
    if (round) ctx.restore();
    return { blob: await toBlob(canvas, 'image/png', 1), width: px, height: px };
  };
  const logo = await render(src, 512, 600_000, 'image/png');
  const icon192 = await make(192, 0.04, false);
  const icon512 = await make(512, 0.04, false);
  const maskable = await make(512, 0.14, false);
  if ('close' in src) src.close();
  return { logo, icon192, icon512, maskable };
}
