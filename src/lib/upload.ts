import { api, ApiError } from './api';
import type { Resized } from './image';

export type ImageKind = 'photo' | 'thumb' | 'receipt' | 'cover' | 'poster' | 'logo' | 'icon';

export async function uploadImage(img: Resized, kind: ImageKind, access?: 'public' | 'members'): Promise<string> {
  const qs = new URLSearchParams({ kind, w: String(img.width), h: String(img.height) });
  if (access) qs.set('access', access);
  const r = await api<{ id: string }>(`/media?${qs}`, { method: 'POST', raw: img.blob, contentType: img.blob.type || 'image/jpeg' });
  return r.id;
}

function putWithProgress(url: string, blob: Blob, onProgress: (loaded: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-irn', '1');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `Erro ${xhr.status}`;
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {
          /* mantém */
        }
        reject(new ApiError(msg, xhr.status));
      }
    };
    xhr.onerror = () => reject(new ApiError('A conexão caiu durante o envio.', 0));
    xhr.onabort = () => reject(new DOMException('cancelado', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

export interface VideoMeta {
  duration: number | null;
  width: number | null;
  height: number | null;
  poster: Resized | null;
}

/** Lê duração, tamanho e tira uma "foto" do vídeo para usar de capa. */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    let done = false;
    const finish = (meta: VideoMeta) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    const timer = setTimeout(() => finish({ duration: null, width: null, height: null, poster: null }), 8000);
    v.onloadedmetadata = () => {
      const t = isFinite(v.duration) ? Math.min(1, v.duration / 3) : 0.5;
      v.currentTime = t;
    };
    v.onseeked = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        const scale = Math.min(1, 1280 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timer);
            finish({
              duration: isFinite(v.duration) ? v.duration : null,
              width: w || null,
              height: h || null,
              poster: blob ? { blob, width: canvas.width, height: canvas.height } : null,
            });
          },
          'image/jpeg',
          0.8,
        );
      } catch {
        clearTimeout(timer);
        finish({ duration: isFinite(v.duration) ? v.duration : null, width: v.videoWidth || null, height: v.videoHeight || null, poster: null });
      }
    };
    v.onerror = () => {
      clearTimeout(timer);
      finish({ duration: null, width: null, height: null, poster: null });
    };
    v.src = url;
  });
}

export function videoMime(file: File): string {
  if (file.type) return file.type === 'video/x-m4v' ? 'video/mp4' : file.type;
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  return 'video/mp4';
}

/** Envia o vídeo em partes de 8 MB (tenta de novo cada parte até 3 vezes). */
export async function uploadVideo(
  file: File,
  meta: VideoMeta,
  access: 'public' | 'members',
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ mediaId: string; posterId: string | null }> {
  const start = await api<{ id: string; partSize: number; parts: number }>('/media/video/start', {
    method: 'POST',
    body: { mime: videoMime(file), size: file.size, access },
  });
  try {
    let sent = 0;
    for (let n = 1; n <= start.parts; n++) {
      const blob = file.slice((n - 1) * start.partSize, n * start.partSize);
      for (let attempt = 1; ; attempt++) {
        try {
          await putWithProgress(`/api/media/video/${start.id}/part/${n}`, blob, (l) => onProgress((sent + l) / file.size), signal);
          break;
        } catch (e) {
          if ((e as Error).name === 'AbortError' || attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      sent += blob.size;
      onProgress(sent / file.size);
    }
    await api(`/media/video/${start.id}/complete`, {
      method: 'POST',
      body: { duration: meta.duration, width: meta.width, height: meta.height },
    });
  } catch (e) {
    await api(`/media/video/${start.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw e;
  }
  let posterId: string | null = null;
  if (meta.poster) posterId = await uploadImage(meta.poster, 'poster', access).catch(() => null);
  return { mediaId: start.id, posterId };
}
