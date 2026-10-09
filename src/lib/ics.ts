/** "Adicionar à agenda" (Google Agenda ou arquivo .ics para iPhone/Outlook). */

function stamp(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

export interface CalItem {
  title: string;
  start: number;
  end?: number | null;
  location?: string | null;
  details?: string | null;
  weekly?: boolean;
}

export function googleCalendarUrl(it: CalItem) {
  const end = it.end ?? it.start + 2 * 3600_000;
  const qs = new URLSearchParams({
    action: 'TEMPLATE',
    text: it.title,
    dates: `${stamp(it.start)}/${stamp(end)}`,
    location: it.location ?? '',
    details: it.details ?? '',
  });
  if (it.weekly) qs.set('recur', 'RRULE:FREQ=WEEKLY');
  return `https://calendar.google.com/calendar/render?${qs}`;
}

export function downloadIcs(it: CalItem, filename = 'evento-irn.ics') {
  const end = it.end ?? it.start + 2 * 3600_000;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//IRN//App da Igreja//PT',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${it.start}-${Math.random().toString(36).slice(2)}@irn`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(it.start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(it.title)}`,
    it.location ? `LOCATION:${esc(it.location)}` : '',
    it.details ? `DESCRIPTION:${esc(it.details)}` : '',
    it.weekly ? 'RRULE:FREQ=WEEKLY' : '',
    'BEGIN:VALARM',
    'TRIGGER:-PT60M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Lembrete',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Compartilhar (WhatsApp etc.) com o menu do celular; se não houver, copia o link. */
export async function share(title: string, text: string, path: string): Promise<'shared' | 'copied' | 'none'> {
  const url = new URL(path, location.origin).toString();
  try {
    if (navigator.share) {
      await navigator.share({ title, text, url });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'none';
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return 'none';
  }
}
