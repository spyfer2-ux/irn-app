import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, History, Radio, Square, MonitorPlay } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { HomeData, Live, Video } from '../lib/types';
import { hourLabel, relativeDay, timeOf, WEEKDAYS } from '../lib/format';
import { helpDrain } from '../lib/push';
import { Button, confirmDialog, Page, Section, TextField, Toggle, useAction } from '../components/ui';
import { useLiveState } from '../components/Layout';
import { VideoCard } from '../components/cards';

export function YouTubeLive({ live }: { live: Live }) {
  const src = live.youtube_id
    ? `https://www.youtube.com/embed/${live.youtube_id}?autoplay=1&playsinline=1&rel=0`
    : `https://www.youtube.com/embed/live_stream?channel=${live.channel_id}&autoplay=1&playsinline=1`;
  return (
    <div className="player player-full">
      <iframe
        src={src}
        title={live.title || 'Live no YouTube'}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function LiveControls({ live, onChange }: { live: Live | null; onChange: () => Promise<void> }) {
  const wd = WEEKDAYS[new Date().getDay()];
  const [title, setTitle] = useState(`Culto de ${wd}`);
  const [url, setUrl] = useState('');
  const [notify, setNotify] = useState(true);
  const { busy, run } = useAction();

  if (live?.active) {
    return (
      <div className="card card-pad stack">
        <div className="row">
          <span className="badge live">AO VIVO</span>
          <span className="small muted">desde {timeOf(live.started_at)} · YouTube</span>
        </div>
        <Button
          variant="danger"
          icon={<Square />}
          loading={busy}
          onClick={async () => {
            if (!(await confirmDialog({ title: 'Encerrar a live?', text: 'O aviso de "ao vivo" sai do app para todos.', confirmLabel: 'Encerrar', danger: true }))) return;
            await run(async () => {
              await api('/live/encerrar', { method: 'POST' });
              await onChange();
            }, 'Live encerrada.');
          }}
        >
          Encerrar live
        </Button>
      </div>
    );
  }

  return (
    <div className="card card-pad stack">
      <div style={{ fontWeight: 650 }}>Começar uma live</div>
      <p className="small muted">
        Comece a live no YouTube (celular ou computador) e depois avise aqui. O app mostra o vídeo para todos e manda a notificação.
      </p>
      <TextField label="Título" value={title} onChange={setTitle} maxLength={120} />
      <TextField
        label="Link da live no YouTube (opcional)"
        value={url}
        onChange={setUrl}
        placeholder="https://youtube.com/live/…"
        hint="No YouTube: Compartilhar → Copiar link. Se ficar vazio, o app mostra a live atual do canal da igreja."
        inputMode="url"
      />
      <Toggle label="Avisar todo mundo (notificação no celular)" checked={notify} onChange={setNotify} />
      <Button
        variant="live"
        icon={<MonitorPlay />}
        loading={busy}
        onClick={() =>
          void run(async () => {
            await api('/live/iniciar', { method: 'POST', body: { source: 'youtube', title, youtube_url: url, notify } });
            await onChange();
            if (notify) void helpDrain();
          }, 'Live no ar no app!')
        }
      >
        Estamos ao vivo
      </Button>
    </div>
  );
}

export default function LivePage() {
  const { church, schedule, isMedia } = useSession();
  const [live, refresh] = useLiveState();
  const { data: home } = useApi<HomeData>('/home');
  const { data: vids } = useApi<{ videos: Video[] }>('/videos?limite=6');

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const channelUrl = church.youtube_url || (church.youtube_channel_id ? `https://www.youtube.com/channel/${church.youtube_channel_id}` : '');

  return (
    <Page
      title="Ao vivo"
      actions={
        isMedia ? (
          <Link to="/ao-vivo/historico" className="icon-btn" aria-label="Histórico de lives">
            <History />
          </Link>
        ) : undefined
      }
    >
      <div className="stack-lg">
        {live?.active ? (
          <div className="stack">
            <YouTubeLive live={live} />
            <div className="row-between">
              <div className="grow">
                <span className="badge live">AO VIVO</span>
                <h2 style={{ fontSize: 20, marginTop: 8 }}>{live.title || 'Culto ao vivo'}</h2>
                <div className="small muted">Começou às {timeOf(live.started_at)}</div>
              </div>
            </div>
            {live.source === 'youtube' && (
              <a
                className="btn btn-secondary"
                href={live.youtube_id ? `https://www.youtube.com/watch?v=${live.youtube_id}` : `${channelUrl}/live`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink /> Abrir no app do YouTube
              </a>
            )}
          </div>
        ) : (
          <div className="card card-pad">
            <div className="empty" style={{ padding: '18px 10px' }}>
              <div className="icon-tile gray">
                <Radio />
              </div>
              <h3>Nenhuma transmissão agora</h3>
              <p className="small">
                {home?.next_cults[0]
                  ? `Próximo culto: ${relativeDay(home.next_cults[0].date).toLowerCase()} às ${hourLabel(home.next_cults[0].time)}. Ative as notificações para saber quando a live começar.`
                  : 'Ative as notificações para saber quando a live começar.'}
              </p>
              <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link className="btn btn-primary btn-sm" to="/perfil#notificacoes">
                  Ativar notificações
                </Link>
                {channelUrl && (
                  <a className="btn btn-secondary btn-sm" href={channelUrl} target="_blank" rel="noopener noreferrer">
                    <MonitorPlay /> Canal no YouTube
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {isMedia && <LiveControls live={live} onChange={refresh} />}

        <Section title="Horários dos cultos">
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
                      {WEEKDAYS[s.weekday]} às {hourLabel(s.time)}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {vids && vids.videos.length > 0 && (
          <Section title="Cultos e vídeos recentes" action={<Link to="/videos">Ver todos</Link>}>
            <div className="video-grid">
              {vids.videos.map((v) => (
                <VideoCard key={v.id} v={v} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </Page>
  );
}

export function LiveHistory() {
  const { data } = useApi<{ lives: { id: number; source: string; title: string; started_at: number; ended_at: number | null; started_by_name: string | null }[] }>('/live/historico');
  return (
    <Page title="Histórico de lives" back="/ao-vivo">
      <div className="card">
        <div className="list">
          {(data?.lives ?? []).map((l) => (
            <div key={l.id} className="list-item" style={{ cursor: 'default' }}>
              <div className={`icon-tile ${l.ended_at ? 'gray' : 'live'}`}>
                <MonitorPlay />
              </div>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{l.title}</div>
                <div className="small muted">
                  {new Date(l.started_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}
                  {l.ended_at ? ` · ${Math.round((l.ended_at - l.started_at) / 60000)} min` : ' · ao vivo'}
                  {l.started_by_name ? ` · ${l.started_by_name}` : ''}
                </div>
              </div>
            </div>
          ))}
          {data && !data.lives.length && <div className="list-item muted">Nenhuma live registrada ainda.</div>}
        </div>
      </div>
    </Page>
  );
}

