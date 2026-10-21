import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, ExternalLink, MapPin, Pin, Play } from 'lucide-react';
import type { Church, Cult, EventItem, Notice, Video } from '../lib/types';
import { ago, duration, hourLabel, longDate, MONTHS_SHORT, parts, relativeDay, timeOf, untilLabel, WEEKDAYS, ymdParts } from '../lib/format';
import { downloadIcs, googleCalendarUrl, type CalItem } from '../lib/ics';
import { isIos } from '../lib/push';
import { MediaImg, mediaUrl } from './ui';

/** Por quantos dias um vídeo recém-publicado aparece como novidade no app. */
export const DIAS_NOVO = 3;

/**
 * Novidade: entrou no app nos últimos DIAS_NOVO dias E foi publicado nesse mesmo prazo.
 * Vale a data mais antiga das duas, para um vídeo velho do canal não virar "novo" só porque
 * a importação automática acabou de trazer ele.
 */
export function isVideoNovo(v: Pick<Video, 'created_at' | 'published_at'> | undefined | null): boolean {
  if (!v) return false;
  const entrou = v.created_at || v.published_at;
  const publicado = v.published_at || v.created_at;
  if (!entrou || !publicado) return false;
  return Date.now() - Math.min(entrou, publicado) < DIAS_NOVO * 86400000;
}

/** Capa que o próprio Google Drive gera para o arquivo. */
export function driveThumb(id: string, largura = 960) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${largura}`;
}

/** Endereço que entrega o arquivo do Drive direto, sem login, e aceita avançar o vídeo. */
export function driveFileUrl(id: string) {
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

/**
 * Vídeo guardado no Google Drive. Toca no player do próprio celular, como o YouTube:
 * nada de quadro do Drive, nada de pedir login. Se o Google não entregar o arquivo
 * (cota do dia, formato que o aparelho não abre), cai no quadro do Drive como plano B.
 */
export function DriveVideo({
  id,
  title,
  posterId,
  full,
  vertical,
}: {
  id: string;
  title?: string | null;
  posterId?: string | null;
  full?: boolean;
  vertical?: boolean;
}) {
  const [semArquivo, setSemArquivo] = useState(false);
  const [emPe, setEmPe] = useState(!!vertical);
  const classe = `player${full ? ' player-full' : ''}${emPe ? ' vertical' : ''}`;

  if (semArquivo) {
    return (
      <div className={classe}>
        <iframe
          src={`https://drive.google.com/file/d/${id}/preview`}
          title={title || 'Vídeo'}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  return (
    <div className={classe}>
      <video
        src={driveFileUrl(id)}
        poster={posterId ? mediaUrl(posterId) : driveThumb(id)}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          // O próprio arquivo diz se é em pé.
          const el = e.currentTarget;
          if (el.videoHeight > el.videoWidth) setEmPe(true);
        }}
        onError={() => setSemArquivo(true)}
      />
    </div>
  );
}

export function videoThumb(v: Pick<Video, 'source' | 'youtube_id' | 'drive_id' | 'poster_id'>) {
  if (v.poster_id) return mediaUrl(v.poster_id);
  if (v.source === 'youtube' && v.youtube_id) return `https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`;
  if (v.source === 'drive' && v.drive_id) return driveThumb(v.drive_id, 640);
  return '';
}

type VideoBrief = Pick<
  Video,
  'id' | 'source' | 'youtube_id' | 'drive_id' | 'poster_id' | 'title' | 'duration' | 'published_at' | 'created_at' | 'category'
>;

/** Cartão grande do vídeo mais novo, para o topo da tela Vídeos e para o Início. */
export function VideoHighlight({ v }: { v: VideoBrief }) {
  const thumb = videoThumb(v);
  return (
    <Link to={`/videos/${v.id}`} className="card video-highlight">
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" referrerPolicy="no-referrer" /> : null}
        <div className="play">
          <span>
            <Play size={24} fill="currentColor" />
          </span>
        </div>
        {v.duration ? <span className="dur">{duration(v.duration)}</span> : null}
      </div>
      <div className="card-pad">
        <div className="kicker">Novo vídeo publicado</div>
        <h3>{v.title}</h3>
        <div className="small muted mt-1">{[v.category, ago(v.published_at)].filter(Boolean).join(' · ')}</div>
      </div>
    </Link>
  );
}

export function VideoCard({ v }: { v: VideoBrief }) {
  const thumb = videoThumb(v);
  return (
    <Link to={`/videos/${v.id}`} className="video-card">
      <div className="thumb">
        {thumb ? <img src={thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null}
        <div className="play">
          <span>
            <Play size={20} fill="currentColor" />
          </span>
        </div>
        {isVideoNovo(v) && <span className="novo">Novo</span>}
        {v.duration ? <span className="dur">{duration(v.duration)}</span> : null}
      </div>
      <div className="vt clamp-2">{v.title}</div>
      <div className="tiny muted mt-1">
        {v.category ? `${v.category} · ` : ''}
        {ago(v.published_at)}
      </div>
    </Link>
  );
}

export function DateTile({ ms, ymd }: { ms?: number; ymd?: string }) {
  const p = ms !== undefined ? parts(ms) : ymdParts(ymd!);
  return (
    <div className="date-tile" aria-hidden>
      <div className="m">{MONTHS_SHORT[p.month - 1]}</div>
      <div className="d">{p.day}</div>
    </div>
  );
}

export function EventCard({ e }: { e: Pick<EventItem, 'id' | 'title' | 'starts_at' | 'location' | 'cover_id' | 'category'> & Partial<EventItem> }) {
  return (
    <Link to={`/agenda/${e.id}`} className="card card-link card-pad" style={{ padding: 14 }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <DateTile ms={e.starts_at} />
        <div className="grow">
          <div style={{ fontWeight: 650 }} className="clamp-2">
            {e.title}
          </div>
          <div className="small muted">
            {relativeDay(parts(e.starts_at).ymd)} às {timeOf(e.starts_at)}
            {e.location ? ` · ${e.location}` : ''}
          </div>
          <div className="wrap-row mt-1">
            {e.category && <span className="badge">{e.category}</span>}
            {e.canceled ? <span className="badge danger">Cancelado</span> : null}
            {e.my_rsvp === 'vou' && <span className="badge ok">Você vai</span>}
            {e.visibility === 'members' && <span className="badge blue">Só membros</span>}
          </div>
        </div>
        {e.cover_id && <MediaImg id={e.cover_id} className="cover-sm" />}
      </div>
    </Link>
  );
}

export function NoticeCard({ n, onEdit }: { n: Notice; onEdit?: () => void }) {
  return (
    <article className="card" style={{ overflow: 'hidden' }}>
      {n.image_id && <MediaImg id={n.image_id} className="cover" style={{ borderRadius: 0 }} />}
      <div className="card-pad">
        <div className="row-between" style={{ alignItems: 'flex-start' }}>
          <h3 style={{ fontSize: 16.5 }}>{n.title}</h3>
          {n.pinned ? <Pin size={16} style={{ color: 'var(--gold)', flex: 'none' }} aria-label="Fixado" /> : null}
        </div>
        {n.body && <p className="pre mt-1" style={{ color: 'var(--ink-2)' }}>{n.body}</p>}
        <div className="row-between mt-2">
          <span className="tiny muted">{ago(n.created_at)}</span>
          <div className="row" style={{ gap: 4 }}>
            {n.link && (
              <a className="btn btn-soft btn-sm" href={n.link} target="_blank" rel="noopener noreferrer">
                Abrir link <ExternalLink />
              </a>
            )}
            {onEdit && (
              <button className="btn btn-ghost btn-sm" onClick={onEdit}>
                Editar
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function cultCalendar(c: Cult, church: Church) {
  return {
    title: `${c.title} — ${church.short}`,
    start: c.at,
    end: c.at + 2 * 3600_000,
    location: `${church.address}, ${church.district}, ${church.city}`,
    details: church.name,
    weekly: true,
  };
}

export function NextCultCard({ cults, church, now }: { cults: Cult[]; church: Church; now: number }) {
  if (!cults.length) return null;
  const [next, ...rest] = cults;
  const p = ymdParts(next.date);
  const until = untilLabel(next.at, now);
  const cal = cultCalendar(next, church);
  return (
    <div className="card card-pad">
      <div className="row-between">
        <span className="badge blue">Próximo culto</span>
        {until && <span className="small countdown" style={{ fontWeight: 600, color: until.startsWith('Acontecendo') ? 'var(--live)' : 'var(--ink-2)' }}>{until}</span>}
      </div>
      <div className="next-cult mt-2">
        <div className="date-tile" aria-hidden>
          <div className="m">{WEEKDAYS[p.weekday].slice(0, 3)}</div>
          <div className="d">{p.day}</div>
        </div>
        <div className="grow">
          <div style={{ fontWeight: 650, fontSize: 17 }}>{next.title}</div>
          <div className="small" style={{ color: 'var(--ink-2)' }}>
            {relativeDay(next.date) === 'Hoje' ? 'Hoje' : longDate(next.date)} às {hourLabel(next.time)}
          </div>
          <div className="small muted row" style={{ gap: 4, marginTop: 2 }}>
            <MapPin size={14} /> {church.address}
          </div>
        </div>
      </div>
      <div className="row mt-2" style={{ flexWrap: 'wrap' }}>
        {church.maps_url && (
          <a className="btn btn-secondary btn-sm" href={church.maps_url} target="_blank" rel="noopener noreferrer">
            <MapPin /> Como chegar
          </a>
        )}
        <AddToCalendar item={cal} filename="culto-irn.ics" label="Agendar" />
      </div>
      {rest.length > 0 && (
        <div className="small muted mt-2">
          Depois: {rest.slice(0, 2).map((c) => `${relativeDay(c.date)} ${hourLabel(c.time)}`).join(' · ')}
        </div>
      )}
    </div>
  );
}

/** No iPhone baixa o arquivo de agenda (abre o Calendário); nos outros, abre o Google Agenda. */
export function AddToCalendar({ item, filename, label = 'Adicionar à agenda' }: { item: CalItem; filename: string; label?: string }) {
  if (isIos())
    return (
      <button className="btn btn-ghost btn-sm" onClick={() => downloadIcs(item, filename)} title="Adicionar à agenda do celular">
        <CalendarPlus /> {label}
      </button>
    );
  return (
    <a className="btn btn-ghost btn-sm" href={googleCalendarUrl(item)} target="_blank" rel="noopener noreferrer" title="Adicionar à agenda do celular">
      <CalendarPlus /> {label}
    </a>
  );
}
