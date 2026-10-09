const TZ = 'America/Sao_Paulo';

export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const WEEKDAYS_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

interface Parts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  ymd: string;
}

let fmt: Intl.DateTimeFormat | null = null;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Data/hora no fuso de São Paulo, não importa o fuso do celular. */
export function parts(ms: number): Parts {
  fmt ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  const year = +p.year;
  const month = +p.month;
  const day = +p.day;
  return {
    year,
    month,
    day,
    weekday: WD.indexOf(p.weekday),
    hour: +p.hour % 24,
    minute: +p.minute,
    ymd: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  };
}

export function ymdParts(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { year: y, month: m, day: d, weekday };
}

export function addDaysYmd(ymd: string, n: number) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const todayYmd = () => parts(Date.now()).ymd;

/** "20h", "18h30" */
export function hourLabel(time: string) {
  const [h, m] = time.split(':');
  return `${Number(h)}h${m && m !== '00' ? m : ''}`;
}

export function timeOf(ms: number) {
  const p = parts(ms);
  return `${p.hour}h${p.minute ? String(p.minute).padStart(2, '0') : ''}`;
}

/** "domingo, 12 de outubro" */
export function longDate(ymdOrMs: string | number) {
  const p = typeof ymdOrMs === 'number' ? parts(ymdOrMs) : ymdParts(ymdOrMs);
  return `${WEEKDAYS_FULL[p.weekday]}, ${p.day} de ${MONTHS[p.month - 1]}`;
}

/** "12/10/2026" */
export function shortDate(ymdOrMs: string | number) {
  const p = typeof ymdOrMs === 'number' ? parts(ymdOrMs) : ymdParts(ymdOrMs);
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

/** "Hoje", "Amanhã", "Domingo" ou "12/10" */
export function relativeDay(ymd: string) {
  const today = todayYmd();
  if (ymd === today) return 'Hoje';
  if (ymd === addDaysYmd(today, 1)) return 'Amanhã';
  const p = ymdParts(ymd);
  const diff = (Date.parse(ymd) - Date.parse(today)) / 86400000;
  if (diff > 0 && diff < 7) return WEEKDAYS[p.weekday];
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
}

/** "há 5 min", "ontem", "12 de out." */
export function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'ontem';
  if (d < 7) return `há ${d} dias`;
  const p = parts(ms);
  const thisYear = parts(Date.now()).year === p.year;
  return `${p.day} de ${MONTHS_SHORT[p.month - 1]}${thisYear ? '' : ` de ${p.year}`}`;
}

export function money(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function duration(sec: number | null | undefined) {
  if (!sec || !isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

export function firstName(name: string | null | undefined) {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function greeting() {
  const h = parts(Date.now()).hour;
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Contagem regressiva amigável: "começa em 2 h 15 min", "começou agora" */
export function untilLabel(at: number, now = Date.now()) {
  const diff = at - now;
  if (diff <= 0) return diff > -2 * 3600_000 ? 'Acontecendo agora' : '';
  const min = Math.round(diff / 60000);
  if (min < 60) return `Começa em ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `Começa em ${h} h${m ? ` ${m} min` : ''}`;
  const d = Math.round(h / 24);
  return `Em ${d} dia${d > 1 ? 's' : ''}`;
}

export function phoneLink(phone: string | null | undefined, text?: string) {
  if (!phone) return '';
  let digits = phone.replace(/\D/g, '');
  if (digits.length <= 11) digits = `55${digits}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

/** Primeira letra maiúscula: "sexta-feira, 16 de outubro" → "Sexta-feira, 16 de outubro" */
export function cap(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** "domingos, quartas e sextas" a partir dos horários de culto. */
export function weekdaysPhrase(days: number[]) {
  const names = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  const list = [...new Set(days)].sort((a, b) => a - b).map((d) => names[d]);
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}
