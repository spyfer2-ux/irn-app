import type { Env } from './types';
import { now } from './util';

/** Dados da igreja. Tudo pode ser alterado pelo admin em Administração → Configurações. */
export const DEFAULT_CHURCH = {
  name: 'Ministério Profético Restaurando as Nações',
  short: 'IRN',
  subtitle: 'Igreja Restaurando Nações',
  pastor_title: 'Bispo',
  pastor_name: 'Ronaldo Nogueira',
  pastor_display: 'Bispo Ronaldo',
  about: '',
  address: 'Av. dos Nacionalistas, 530',
  district: 'Jardim Tango',
  city: 'São Paulo/SP',
  cep: '03901-010',
  maps_url: 'https://maps.app.goo.gl/wjbXH7ftMkX6u7kR6',
  whatsapp: '5511948404686',
  instagram: 'mprnacoes',
  instagram_youth: 'mprn_jovens',
  instagram_missions: 'mprn_am',
  facebook: 'MPRN.BR',
  youtube_channel_id: 'UCpjS9zkaVeLzy_ON-g35AVA',
  youtube_url: 'https://www.youtube.com/@igrejaministerioprofeticor7766',
  email: '',
  logo_id: '' as string,
  icon192_id: '' as string,
  icon512_id: '' as string,
  maskable_id: '' as string,
};
export type Church = typeof DEFAULT_CHURCH;

export interface ScheduleItem {
  id: string;
  weekday: number; // 0 = domingo
  time: string; // HH:MM
  title: string;
  note: string;
}

export const DEFAULT_SCHEDULE: ScheduleItem[] = [
  { id: 'dom', weekday: 0, time: '18:30', title: 'Culto de Domingo', note: '' },
  { id: 'qua', weekday: 3, time: '20:00', title: 'Culto de Quarta', note: '' },
  { id: 'sex', weekday: 5, time: '20:00', title: 'Culto de Sexta', note: '' },
];

/** Dados para dízimos e ofertas. Ficam vazios até o admin cadastrar. */
export const DEFAULT_GIVING = {
  visible_to: 'members' as 'members' | 'public',
  holder_title: 'Bispo',
  holder_name: 'Ronaldo Nogueira',
  pix_key_type: '' as '' | 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria',
  pix_key: '',
  pix_name: 'RONALDO NOGUEIRA',
  pix_city: 'SAO PAULO',
  bank_name: '',
  bank_code: '',
  agency: '',
  account: '',
  account_type: 'corrente' as 'corrente' | 'poupanca' | 'pagamento',
  holder_doc: '',
  message: '“Trazei todos os dízimos à casa do Tesouro” (Ml 3.10)',
  types: ['Dízimo', 'Oferta', 'Missões', 'Campanha'],
};
export type Giving = typeof DEFAULT_GIVING;

export const DEFAULT_STREAM = { whip_url: '', whep_url: '' };
export const DEFAULT_YOUTUBE = { auto_import: true, last_sync: 0, last_result: '' };
export const DEFAULT_REMINDERS = {
  cult_minutes_before: 60,
  event_minutes_before: 120,
  word_hour: 7,
  birthdays_to_leaders: true,
};

export interface LiveState {
  active: boolean;
  source: 'youtube' | 'app' | '';
  title: string;
  youtube_id: string;
  started_at: number;
  started_by: number | null;
  live_id: number | null;
}
export const DEFAULT_LIVE: LiveState = {
  active: false,
  source: '',
  title: '',
  youtube_id: '',
  started_at: 0,
  started_by: null,
  live_id: null,
};

const DEFAULTS = {
  church: DEFAULT_CHURCH,
  schedule: DEFAULT_SCHEDULE,
  giving: DEFAULT_GIVING,
  stream: DEFAULT_STREAM,
  youtube: DEFAULT_YOUTUBE,
  reminders: DEFAULT_REMINDERS,
  live: DEFAULT_LIVE,
};
export type SettingKey = keyof typeof DEFAULTS;
type SettingVal<K extends SettingKey> = (typeof DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(env: Env, key: K): Promise<SettingVal<K>> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return merge(key, row?.value);
}

export async function getSettings<K extends SettingKey>(env: Env, keys: K[]): Promise<{ [P in K]: SettingVal<P> }> {
  const placeholders = keys.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  const out = {} as { [P in K]: SettingVal<P> };
  for (const k of keys) {
    const r = results.find((x) => x.key === k);
    (out as Record<string, unknown>)[k] = merge(k, r?.value);
  }
  return out;
}

function merge<K extends SettingKey>(key: K, raw: string | undefined): SettingVal<K> {
  const def = DEFAULTS[key];
  if (!raw) return structuredClone(def);
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(def)) return (Array.isArray(v) ? v : structuredClone(def)) as SettingVal<K>;
    return { ...structuredClone(def), ...(v && typeof v === 'object' ? v : {}) } as SettingVal<K>;
  } catch {
    return structuredClone(def);
  }
}

export function setSettingStmt(env: Env, key: SettingKey | 'vapid', value: unknown, userId: number | null) {
  return env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
  ).bind(key, JSON.stringify(value), now(), userId);
}

export async function setSetting(env: Env, key: SettingKey, value: unknown, userId: number | null) {
  await setSettingStmt(env, key, value, userId).run();
}
