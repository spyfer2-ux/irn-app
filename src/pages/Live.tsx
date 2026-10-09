import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ExternalLink, History, Radio, Square, Volume2, MonitorPlay } from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { HomeData, Live, Video } from '../lib/types';
import { hourLabel, relativeDay, timeOf, WEEKDAYS } from '../lib/format';
import { helpDrain } from '../lib/push';
import { Player } from '../lib/webrtc';
import { Button, confirmDialog, Page, Section, Seg, TextField, Toggle, useAction } from '../components/ui';
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

function AppLivePlayer({ url }: { url: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'conectando' | 'aovivo' | 'aguardando'>('conectando');
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    let stopped = false;
    let player: Player | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      if (stopped || !video.current) return;
      player = new Player();
      player.onState = (s) => {
        if (s === 'connected') setState('aovivo');
        if (s === 'failed' || s === 'disconnected' || s === 'closed') {
          if (stopped) return;
          setState('aguardando');
          void player?.stop();
          timer = setTimeout(connect, 4000);
        }
      };
      try {
        setState((st) => (st === 'aovivo' ? st : 'conectando'));
        await player.start(url, video.current);
      } catch {
        setState('aguardando');
        await player?.stop();
        if (!stopped) timer = setTimeout(connect, 5000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      void player?.stop();
    };
  }, [url]);
  return (
    <div className="player player-full">
      <video ref={video} autoPlay playsInline muted={muted} controls={state === 'aovivo'} />
      {state !== 'aovivo' && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center', padding: 20 }}>
          <div>
            <Radio className="spin" style={{ animationDuration: '3s', margin: '0 auto 8px' }} />
            {state === 'conectando' ? 'Conectando à transmissão…' : 'Aguardando a transmissão começar…'}
          </div>
        </div>
      )}
      {state === 'aovivo' && muted && (
        <button className="btn btn-white btn-sm" style={{ position: 'absolute', left: 12, bottom: 12 }} onClick={() => setMuted(false)}>
          <Volume2 /> Ativar som
        </button>
      )}
    </div>
  );
}

function LiveControls({ live, onChange }: { live: Live | null; onChange: () => Promise<void> }) {
  const { features, isAdmin } = useSession();
  const [source, setSource] = useState<'youtube' | 'app'>('youtube');
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
          <span className="small muted">
            desde {timeOf(live.started_at)} · {live.source === 'app' ? 'câmera do app' : 'YouTube'}
          </span>
        </div>
        {live.source === 'app' && (
          <Link className="btn btn-secondary" to="/transmitir">
            <Camera /> Abrir a tela de transmissão
          </Link>
        )}
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
      <Seg
        value={source}
        onChange={setSource}
        options={[
          { value: 'youtube', label: 'Pelo YouTube' },
          { value: 'app', label: 'Câmera do app' },
        ]}
      />
      {source === 'youtube' ? (
        <>
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
        </>
      ) : features.stream_ready ? (
        <>
          <p className="small muted">Transmite direto da câmera deste celular, sem YouTube. Use Wi-Fi e deixe o celular na horizontal, de preferência num tripé.</p>
          <Link className="btn btn-live" to="/transmitir">
            <Camera /> Abrir câmera para transmitir
          </Link>
        </>
      ) : (
        <div className="alert warn">
          <Camera />
          <div>
            A transmissão pela câmera do app ainda não foi configurada.{' '}
            {isAdmin ? <Link to="/admin/config?aba=transmissao">Configurar agora</Link> : 'Peça ao administrador do app.'}
          </div>
        </div>
      )}
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
            {live.source === 'app' && live.whep_url ? <AppLivePlayer url={live.whep_url} /> : <YouTubeLive live={live} />}
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
              <div className={`icon-tile ${l.ended_at ? 'gray' : 'live'}`}>{l.source === 'app' ? <Camera /> : <MonitorPlay />}</div>
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

