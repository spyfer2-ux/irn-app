import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Check, MapPin, Minus, Pencil, Plus, Radio, Share2, Trash2, Users } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { EventItem } from '../lib/types';
import { cap, hourLabel, longDate, parts, timeOf, todayYmd, WEEKDAYS } from '../lib/format';
import { share } from '../lib/ics';
import { helpDrain } from '../lib/push';
import {
  Avatar,
  Button,
  confirmDialog,
  CoverPicker,
  Empty,
  ErrorBox,
  LoadingList,
  MediaImg,
  Page,
  Section,
  Seg,
  SelectField,
  Sheet,
  TextField,
  Toggle,
  toast,
  toastError,
  useAction,
} from '../components/ui';
import { AddToCalendar, EventCard } from '../components/cards';

const CATEGORIES = ['Culto especial', 'Conferência', 'Congresso', 'Rede Jovem', 'Células', 'Batismo', 'Santa Ceia', 'Evangelismo', 'Retiro', 'Missões', 'Outro'];

export default function Agenda() {
  const { schedule, isLeader } = useSession();
  const [period, setPeriod] = useState<'proximos' | 'passados'>('proximos');
  const { data, error, loading, reload } = useApi<{ events: EventItem[] }>(`/eventos?periodo=${period}`);
  const [creating, setCreating] = useState(false);
  return (
    <Page
      title="Agenda"
      actions={
        isLeader ? (
          <Button size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
            Evento
          </Button>
        ) : undefined
      }
    >
      <div className="stack-lg">
        <Section title="Cultos toda semana">
          <div className="card">
            <div className="list">
              {schedule.map((s) => (
                <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
                  <div className="icon-tile">
                    <Radio />
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{s.title}</div>
                    <div className="small muted">
                      Toda {WEEKDAYS[s.weekday].toLowerCase()} às {hourLabel(s.time)}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>
        <section className="stack">
          <Seg
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'proximos', label: 'Próximos eventos' },
              { value: 'passados', label: 'Já aconteceram' },
            ]}
          />
          {error && <ErrorBox error={error} retry={reload} />}
          {loading && !data ? (
            <LoadingList />
          ) : data?.events.length ? (
            data.events.map((e) => <EventCard key={e.id} e={e} />)
          ) : (
            <Empty icon={<CalendarDays />} title={period === 'proximos' ? 'Nenhum evento marcado' : 'Nada por aqui'} text={period === 'proximos' ? 'Os eventos especiais da igreja aparecem aqui.' : undefined} />
          )}
        </section>
      </div>
      {creating && <EventSheet onClose={() => setCreating(false)} onDone={() => void reload()} />}
    </Page>
  );
}

export function EventDetail() {
  const { id } = useParams();
  const { church, isMember, isLeader, user } = useSession();
  const navigate = useNavigate();
  const { data, error, reload, mutate } = useApi<{ event: EventItem; attendees: { name: string; phone: string | null; status: string; guests: number }[] }>(`/eventos/${id}`);
  const [editing, setEditing] = useState(false);
  const [guests, setGuests] = useState(0);
  const { busy, run } = useAction();
  const e = data?.event;
  const past = e ? (e.ends_at ?? e.starts_at + 3 * 3600_000) < Date.now() : false;

  const rsvp = (status: 'vou' | 'talvez' | 'nao') =>
    run(async () => {
      await api(`/eventos/${id}/presenca`, { method: 'POST', body: { status, guests: status === 'vou' ? guests : 0 } });
      mutate((d) => ({ ...d, event: { ...d.event, my_rsvp: status } }));
      void reload();
    }, status === 'vou' ? 'Presença confirmada!' : 'Resposta salva.');

  const cal = e && {
    title: e.title,
    start: e.starts_at,
    end: e.ends_at,
    location: e.location || `${church.address}, ${church.district}, ${church.city}`,
    details: e.description ?? '',
  };

  return (
    <Page
      title="Evento"
      back="/agenda"
      actions={
        e && (
          <>
            <button
              className="icon-btn"
              aria-label="Compartilhar"
              onClick={async () => {
                const r = await share(e.title, `${e.title} — ${longDate(e.starts_at)} às ${timeOf(e.starts_at)}`, `/agenda/${e.id}`);
                if (r === 'copied') toast('Link copiado!', 'ok');
              }}
            >
              <Share2 />
            </button>
            {isLeader && (
              <button className="icon-btn" aria-label="Editar" onClick={() => setEditing(true)}>
                <Pencil />
              </button>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox error={error} retry={reload} />}
      {e && (
        <div className="stack-lg">
          <div className="stack">
            {e.cover_id && <MediaImg id={e.cover_id} className="cover" />}
            <div className="wrap-row">
              {e.category && <span className="badge blue">{e.category}</span>}
              {e.canceled ? <span className="badge danger">Cancelado</span> : null}
              {e.visibility === 'members' && <span className="badge">Só membros</span>}
            </div>
            <h1 style={{ fontSize: 26 }}>{e.title}</h1>
            <div className="card">
              <div className="list">
                <div className="list-item" style={{ cursor: 'default' }}>
                  <div className="icon-tile">
                    <CalendarDays />
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{cap(longDate(e.starts_at))}</div>
                    <div className="small muted">
                      {timeOf(e.starts_at)}
                      {e.ends_at ? ` até ${parts(e.ends_at).ymd !== parts(e.starts_at).ymd ? `${longDate(e.ends_at)}, ` : ''}${timeOf(e.ends_at)}` : ''}
                    </div>
                  </div>
                </div>
                <a
                  className="list-item"
                  href={e.location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(e.location)}` : church.maps_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="icon-tile">
                    <MapPin />
                  </div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{e.location || 'Sede da igreja'}</div>
                    <div className="small muted">{e.location ? 'Abrir no mapa' : `${church.address} · Abrir no mapa`}</div>
                  </div>
                </a>
              </div>
            </div>
            {e.description && <p className="pre" style={{ color: 'var(--ink-2)' }}>{e.description}</p>}
            {cal && !past && (
              <div className="row">
                <AddToCalendar item={cal} filename="evento-irn.ics" />
              </div>
            )}
          </div>

          {e.rsvp && !e.canceled && !past ? (
            <section className="card card-pad stack">
              <div className="row-between">
                <div style={{ fontWeight: 650 }}>Você vai?</div>
                <span className="small muted row" style={{ gap: 4 }}>
                  <Users size={15} /> {e.going} confirmado{e.going === 1 ? '' : 's'}
                  {e.capacity ? ` de ${e.capacity}` : ''}
                </span>
              </div>
              {isMember ? (
                <>
                  <div className="row">
                    <Button variant={e.my_rsvp === 'vou' ? 'ok' : 'secondary'} icon={e.my_rsvp === 'vou' ? <Check /> : undefined} className="grow" loading={busy} onClick={() => void rsvp('vou')}>
                      Vou
                    </Button>
                    <Button variant={e.my_rsvp === 'talvez' ? 'navy' : 'secondary'} className="grow" onClick={() => void rsvp('talvez')}>
                      Talvez
                    </Button>
                    <Button variant={e.my_rsvp === 'nao' ? 'navy' : 'secondary'} className="grow" onClick={() => void rsvp('nao')}>
                      Não vou
                    </Button>
                  </div>
                  <div className="row-between">
                    <span className="small" style={{ color: 'var(--ink-2)' }}>
                      Vou levar mais alguém?
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="icon-btn" style={{ background: 'var(--surface-2)' }} aria-label="Menos" onClick={() => setGuests((g) => Math.max(0, g - 1))}>
                        <Minus size={18} />
                      </button>
                      <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{guests}</span>
                      <button className="icon-btn" style={{ background: 'var(--surface-2)' }} aria-label="Mais" onClick={() => setGuests((g) => Math.min(20, g + 1))}>
                        <Plus size={18} />
                      </button>
                    </div>
                  </div>
                  {guests > 0 && e.my_rsvp === 'vou' && (
                    <Button variant="soft" size="sm" onClick={() => void rsvp('vou')}>
                      Atualizar acompanhantes
                    </Button>
                  )}
                </>
              ) : (
                <p className="small muted">{user ? 'Assim que seu cadastro for aprovado, você pode confirmar presença.' : 'Entre com sua conta para confirmar presença.'}</p>
              )}
            </section>
          ) : null}

          {isLeader && data!.attendees.length > 0 && (
            <Section title={`Lista de presença (${data!.attendees.filter((a) => a.status === 'vou').length})`}>
              <div className="card">
                <div className="list">
                  {data!.attendees.map((a, i) => (
                    <div key={i} className="list-item" style={{ cursor: 'default' }}>
                      <Avatar name={a.name} size={32} />
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                        <div className="small muted">
                          {a.status === 'vou' ? 'Vai' : a.status === 'talvez' ? 'Talvez' : 'Não vai'}
                          {a.guests ? ` · +${a.guests} acompanhante(s)` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}
        </div>
      )}
      {editing && e && (
        <EventSheet
          event={e}
          onClose={() => setEditing(false)}
          onDone={() => void reload()}
          onDeleted={() => navigate('/agenda')}
        />
      )}
    </Page>
  );
}

function EventSheet({ event, onClose, onDone, onDeleted }: { event?: EventItem; onClose: () => void; onDone: () => void; onDeleted?: () => void }) {
  const { church } = useSession();
  const start = event ? parts(event.starts_at) : null;
  const end = event?.ends_at ? parts(event.ends_at) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const [title, setTitle] = useState(event?.title ?? '');
  const [category, setCategory] = useState(event?.category ?? CATEGORIES[0]);
  const [date, setDate] = useState(start?.ymd ?? todayYmd());
  const [time, setTime] = useState(start ? `${pad(start.hour)}:${pad(start.minute)}` : '19:30');
  const [endDate, setEndDate] = useState(end?.ymd ?? '');
  const [endTime, setEndTime] = useState(end ? `${pad(end.hour)}:${pad(end.minute)}` : '');
  const [location, setLocation] = useState(event?.location ?? `${church.address} – ${church.district}`);
  const [desc, setDesc] = useState(event?.description ?? '');
  const [cover, setCover] = useState<string | null>(event?.cover_id ?? null);
  const [isPublic, setIsPublic] = useState(event ? event.visibility === 'public' : true);
  const [rsvp, setRsvp] = useState(event ? !!event.rsvp : true);
  const [capacity, setCapacity] = useState(event?.capacity ? String(event.capacity) : '');
  const [notify, setNotify] = useState(true);
  const [canceled, setCanceled] = useState(!!event?.canceled);
  const { busy, run } = useAction();
  const cats = CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES];

  const save = () =>
    run(async () => {
      const body = {
        title,
        category,
        date,
        time,
        end_date: endTime ? endDate || date : null,
        end_time: endTime || null,
        location,
        description: desc,
        cover_id: cover,
        visibility: isPublic ? 'public' : 'members',
        rsvp,
        capacity: capacity ? Number(capacity) : null,
        notify: !event && notify,
        canceled,
      };
      if (event) await api(`/eventos/${event.id}`, { method: 'PUT', body });
      else await api('/eventos', { method: 'POST', body });
      if ((!event && notify) || (event && canceled && !event.canceled)) void helpDrain();
      onDone();
      onClose();
    }, event ? 'Evento salvo.' : 'Evento criado!');

  return (
    <Sheet
      open
      title={event ? 'Editar evento' : 'Novo evento'}
      onClose={onClose}
      footer={
        <>
          {event && (
            <Button
              variant="danger"
              icon={<Trash2 />}
              onClick={async () => {
                if (!(await confirmDialog({ title: 'Apagar o evento?', text: 'As confirmações de presença também serão apagadas.', confirmLabel: 'Apagar', danger: true }))) return;
                try {
                  await api(`/eventos/${event.id}`, { method: 'DELETE' });
                  toast('Evento apagado.', 'ok');
                  onClose();
                  onDeleted?.();
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Apagar
            </Button>
          )}
          <Button loading={busy} onClick={() => void save()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Nome do evento" value={title} onChange={setTitle} maxLength={120} />
        <SelectField label="Tipo" value={category} onChange={setCategory} options={cats.map((c) => ({ value: c, label: c }))} />
        <div className="form-grid">
          <TextField label="Data" type="date" value={date} onChange={setDate} />
          <TextField label="Horário" type="time" value={time} onChange={setTime} />
        </div>
        <div className="form-grid">
          <TextField label="Termina em (opcional)" type="date" value={endDate} onChange={setEndDate} />
          <TextField label="Horário do fim" type="time" value={endTime} onChange={setEndTime} />
        </div>
        <TextField label="Local" value={location} onChange={setLocation} maxLength={200} />
        <TextField label="Descrição" value={desc} onChange={setDesc} multiline rows={4} maxLength={4000} />
        <CoverPicker value={cover} onChange={setCover} access={isPublic ? 'public' : 'members'} />
        <Toggle label="Evento público" hint={isPublic ? 'Visitantes também veem.' : 'Só membros veem.'} checked={isPublic} onChange={setIsPublic} />
        <Toggle label="Pedir confirmação de presença" checked={rsvp} onChange={setRsvp} />
        {rsvp && <TextField label="Limite de vagas (opcional)" value={capacity} onChange={(v) => setCapacity(v.replace(/\D/g, ''))} inputMode="numeric" />}
        {!event && <Toggle label="Avisar por notificação" hint="Manda uma notificação para os celulares." checked={notify} onChange={setNotify} />}
        {event && <Toggle label="Evento cancelado" hint="Avisa quem acompanha a agenda." checked={canceled} onChange={setCanceled} />}
      </div>
    </Sheet>
  );
}
