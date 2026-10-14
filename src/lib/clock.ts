/** Tempo dos trechos de vídeo ("Cenas que pregam"). */

/** Lê "1:23", "01:02:03", "83" ou "1m23s" → segundos. Vazio → null. Inválido → NaN. */
export function parseClock(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  const parts = t.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return NaN;
  const [a, b, c] = parts.map(Number);
  if (parts.length === 2) return b < 60 ? a * 60 + b : NaN;
  return b < 60 && c < 60 ? a * 3600 + b * 60 + c : NaN;
}
