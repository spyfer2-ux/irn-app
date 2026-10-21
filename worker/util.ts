import type { Ctx, Env, User } from './types';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function fail(status: number, message: string): never {
  throw new HttpError(status, message);
}

export const now = () => Date.now();

// ---------- codificação ----------

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = (s: string) => enc.encode(s);
export const fromUtf8 = (b: Uint8Array) => dec.decode(b);

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return bytesToB64url(b);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s)));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- validação de entrada ----------

export function str(v: unknown, max: number, opts: { required?: boolean; label?: string } = {}): string | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) fail(400, `Preencha ${opts.label ?? 'o campo obrigatório'}.`);
    return null;
  }
  if (typeof v !== 'string') fail(400, `Valor inválido em ${opts.label ?? 'um campo'}.`);
  const t = v.trim();
  if (!t) {
    if (opts.required) fail(400, `Preencha ${opts.label ?? 'o campo obrigatório'}.`);
    return null;
  }
  if (t.length > max) fail(400, `${opts.label ?? 'Texto'} muito longo (máximo ${max} caracteres).`);
  return t;
}

export function reqStr(v: unknown, max: number, label: string): string {
  return str(v, max, { required: true, label }) as string;
}

export function int(v: unknown, min: number, max: number, label = 'número'): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) fail(400, `Valor inválido em ${label}.`);
  return n;
}

export function oneOf<T extends string>(v: unknown, list: readonly T[], label = 'opção'): T {
  if (typeof v !== 'string' || !list.includes(v as T)) fail(400, `Valor inválido em ${label}.`);
  return v as T;
}

export function bool(v: unknown): boolean {
  return v === true || v === 1 || v === '1' || v === 'true' || v === 'on';
}

/** Aceita AAAA-MM-DD. */
export function dateStr(v: unknown, label = 'data'): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(400, `Data inválida em ${label}.`);
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) fail(400, `Data inválida em ${label}.`);
  return v;
}

export function httpsUrl(v: unknown, label = 'link'): string | null {
  const s = str(v, 600, { label });
  if (!s) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    fail(400, `${label}: endereço inválido. Use um link completo, começando com https://`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(400, `${label}: use um link começando com https://`);
  return u.toString();
}

export async function body(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const j = await c.req.json();
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Record<string, unknown>;
  } catch {
    /* cai no erro abaixo */
  }
  fail(400, 'Não consegui ler os dados enviados.');
}

// ---------- permissões ----------
// membro < midia (equipe de mídia) < lider (liderança) < admin

const RANK: Record<string, number> = { membro: 1, midia: 2, lider: 3, admin: 4 };

export function isMember(u: User | null): boolean {
  return !!u && u.status === 'aprovado';
}
export function isMedia(u: User | null): boolean {
  return isMember(u) && RANK[u!.role] >= 2;
}
export function isLeader(u: User | null): boolean {
  return isMember(u) && RANK[u!.role] >= 3;
}
export function isAdmin(u: User | null): boolean {
  return isMember(u) && u!.role === 'admin';
}

export function needUser(c: Ctx): User {
  const u = c.get('user');
  if (!u) fail(401, 'Entre com sua conta Google para continuar.');
  if (u.status === 'bloqueado') fail(403, 'Seu acesso foi bloqueado pela liderança.');
  return u;
}
export function needMember(c: Ctx): User {
  const u = needUser(c);
  if (u.status !== 'aprovado') fail(403, 'Seu cadastro ainda está aguardando a aprovação da liderança.');
  return u;
}
export function needMedia(c: Ctx): User {
  const u = needMember(c);
  if (!isMedia(u)) fail(403, 'Só a equipe de mídia e a liderança podem fazer isso.');
  return u;
}
export function needLeader(c: Ctx): User {
  const u = needMember(c);
  if (!isLeader(u)) fail(403, 'Só a liderança pode fazer isso.');
  return u;
}
export function needAdmin(c: Ctx): User {
  const u = needMember(c);
  if (u.role !== 'admin') fail(403, 'Só administradores podem fazer isso.');
  return u;
}

/** Visibilidades que o usuário pode ver: visitantes só veem o que é público. */
export function visibleSet(u: User | null): string[] {
  return isMember(u) ? ['public', 'members'] : ['public'];
}

// ---------- datas no horário de São Paulo (a igreja fica lá, mesmo se o servidor estiver em outro fuso) ----------

const TZ = 'America/Sao_Paulo';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let spFmt: Intl.DateTimeFormat | null = null;

export interface SpParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  ymd: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Partes do horário de São Paulo para um instante. */
export function spParts(ms: number): SpParts {
  try {
    spFmt ??= new Intl.DateTimeFormat('en-US', {
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
    for (const part of spFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
    const year = Number(p.year);
    const month = Number(p.month);
    const day = Number(p.day);
    const weekday = WEEKDAYS.indexOf(p.weekday);
    if (!year || !month || !day || weekday < 0) throw new Error('fuso');
    return { year, month, day, weekday, hour: Number(p.hour) % 24, minute: Number(p.minute), ymd: `${year}-${pad2(month)}-${pad2(day)}` };
  } catch {
    const d = new Date(ms - 180 * 60000); // reserva: UTC-3
    const year = d.getUTCFullYear();
    return {
      year,
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      ymd: `${year}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    };
  }
}

function spOffsetMin(ms: number): number {
  const floor = ms - (((ms % 60000) + 60000) % 60000);
  const p = spParts(floor);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - floor) / 60000);
}

/** Instante (ms) de um dia AAAA-MM-DD às HH:MM no horário de São Paulo. */
export function spToMs(ymd: string, hhmm: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  let t = local + 180 * 60000;
  const off1 = spOffsetMin(t);
  t = local - off1 * 60000;
  const off2 = spOffsetMin(t);
  if (off2 !== off1) t = local - off2 * 60000;
  return t;
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function hhmm(v: unknown, label = 'horário'): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) fail(400, `Horário inválido em ${label}. Use o formato 19:30.`);
  return v;
}

export interface CultItem {
  id: string;
  weekday: number;
  time: string;
  title: string;
  note: string;
}

/** Próximos cultos a partir de agora (inclui o culto que começou há menos de 2 horas). */
export function nextCults(schedule: CultItem[], from: number, days = 8) {
  const today = spParts(from).ymd;
  const out: (CultItem & { date: string; at: number })[] = [];
  for (let i = 0; i < days; i++) {
    const ymd = addDays(today, i);
    const wd = weekdayOf(ymd);
    for (const s of schedule) {
      if (s.weekday !== wd || !/^\d{2}:\d{2}$/.test(s.time)) continue;
      const at = spToMs(ymd, s.time);
      if (at + 2 * 3600_000 > from) out.push({ ...s, date: ymd, at });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function originOf(c: Ctx): string {
  return new URL(c.req.url).origin;
}

/** Limite simples de tentativas por chave (ex.: por usuário ou por IP). */
export async function rateLimit(env: Env, key: string, max: number, windowMs: number): Promise<void> {
  const t = now();
  const row = await env.DB.prepare(
    `INSERT INTO rate (key, count, reset_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN reset_at < ? THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at < ? THEN ? ELSE reset_at END
     RETURNING count`,
  )
    .bind(key, t + windowMs, t, t, t + windowMs)
    .first<{ count: number }>();
  if (row && row.count > max) fail(429, 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.');
}

export function clientIp(c: Ctx): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

export function auditLog(c: Ctx, userId: number | null, action: string, detail = ''): D1PreparedStatement {
  return c.env.DB.prepare('INSERT INTO audit (user_id, action, detail, created_at) VALUES (?, ?, ?, ?)').bind(
    userId,
    action,
    detail.slice(0, 500),
    now(),
  );
}
