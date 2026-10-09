/**
 * PIX "copia e cola" (BR Code estático), seguindo o padrão do Banco Central.
 * O código é gerado no próprio celular: nenhum dado bancário passa por terceiros.
 */

function tlv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function plain(s: string, max: number) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .-]/g, '')
    .trim()
    .slice(0, max);
}

export interface PixInput {
  key: string;
  name: string;
  city: string;
  amountCents?: number | null;
  txid?: string;
  description?: string;
}

export function pixPayload({ key, name, city, amountCents, txid, description }: PixInput): string {
  let account = tlv('00', 'br.gov.bcb.pix') + tlv('01', key);
  const desc = description ? plain(description, 40) : '';
  if (desc && account.length + 4 + desc.length <= 99) account += tlv('02', desc);
  const id = (txid ? plain(txid, 25).replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '') || '***';
  let payload =
    tlv('00', '01') +
    tlv('26', account) +
    tlv('52', '0000') +
    tlv('53', '986') +
    (amountCents && amountCents > 0 ? tlv('54', (amountCents / 100).toFixed(2)) : '') +
    tlv('58', 'BR') +
    tlv('59', plain(name, 25).toUpperCase() || 'IGREJA') +
    tlv('60', plain(city, 15).toUpperCase() || 'SAO PAULO') +
    tlv('62', tlv('05', id));
  payload += '6304';
  return payload + crc16(payload);
}

/** "150,00" → 15000 centavos. Aceita vazio (sem valor fixo). */
export function parseCents(v: string): number | null {
  const clean = v.replace(/R\$|\s/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Math.round(Number(normalized) * 100);
  return Number.isFinite(n) && n > 0 ? n : null;
}
