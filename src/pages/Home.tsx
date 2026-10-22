import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  Check,
  ChevronRight,
  Clock,
  Gift,
  Church,
  HandCoins,
  HandHelping,
  Images,
  MapPin,
  MessageSquareHeart,
  Mic,
  PlaySquare,
  Radio,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { useSession } from '../lib/session';
import { api, useApi } from '../lib/api';
import type { HomeData } from '../lib/types';
import { firstName, greeting, weekdaysPhrase } from '../lib/format';
import { Avatar, Button, MediaImg, Section, Skeleton, toastError } from '../components/ui';
import { EventCard, isVideoNovo, NextCultCard, NoticeCard, VideoCard, VideoHighlight } from '../components/cards';
import { InstallBanner } from './Account';
import { BibleShortcut } from './Bible';
import { PastorHomeCard } from './Extras';

/** Atalho dos cultos: abre a tela Vídeos já filtrada na categoria dos cultos. */
const CULTOS = `/videos?categoria=${encodeURIComponent('Cultos e pregações')}`;

export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export default function Home() {
  const { user, church, schedule, isMember, isLeader } = useSession();
  const { data, reload, mutate } = useApi<HomeData>('/home');
  const now = useNow();

  useEffect(() => {
    document.title = `${church.short} · ${church.name}`;
  }, [church]);

  const checkin = async (id: number) => {
    try {
      await api(`/campanhas/${id}/checkin`, { method: 'POST', body: {} });
      mutate((d) => ({ ...d, campaigns: d.campaigns.map((c) => (c.id === id ? { ...c, done_today: c.done_today ? 0 : 1, joined: 1 } : c)) }));
    } catch (e) {
      toastError(e);
    }
  };

  const quick = isMember
    ? [
        { to: '/ao-vivo', label: 'Ao vivo', icon: <Radio />, tone: 'live' },
        { to: '/videos', label: 'Vídeos', icon: <PlaySquare />, tone: '' },
        { to: '/fotos', label: 'Fotos', icon: <Images />, tone: '' },
        { to: CULTOS, label: 'Cultos', icon: <Church />, tone: 'gold' },
        { to: '/dizimos', label: 'Dízimos e ofertas', icon: <HandCoins />, tone: 'gold' },
        { to: '/testemunhos', label: 'Testemunhos', icon: <MessageSquareHeart />, tone: '' },
        { to: '/ajuda', label: 'Ajuda mútua', icon: <HandHelping />, tone: '' },
        { to: '/mensagem', label: 'Mensagem do Pastor', icon: <Mic />, tone: 'gold' },
      ]
    : [
        { to: '/ao-vivo', label: 'Ao vivo', icon: <Radio />, tone: 'live' },
        { to: '/videos', label: 'Vídeos', icon: <PlaySquare />, tone: '' },
        { to: '/igreja', label: 'Como chegar', icon: <MapPin />, tone: '' },
        { to: '/visitante', label: 'Sou visitante', icon: <UserPlus />, tone: 'gold' },
        { to: '/dizimos', label: 'Dízimos e ofertas', icon: <HandCoins />, tone: 'gold' },
        { to: '/testemunhos', label: 'Testemunhos', icon: <MessageSquareHeart />, tone: '' },
        { to: '/ajuda', label: 'Ajuda mútua', icon: <HandHelping />, tone: '' },
        { to: '/mensagem', label: 'Mensagem do Pastor', icon: <Mic />, tone: 'gold' },
      ];

  const videoNovo = data && data.videos.length && isVideoNovo(data.videos[0]) ? data.videos[0] : null;
  const pendingTotal = data?.pending ? data.pending.users + data.pending.testimonies + data.pending.visitors + data.pending.requests + (data.pending.help ?? 0) : 0;

  return (
    <>
      <header className="hero">
        <div className="wrap">
          <div className="hero-top">
            <img className="hero-logo" src="/api/brand/logo" alt={`Logo ${church.short}`} />
            <div className="grow hero-name">
              {church.short}
              <br />
              <span style={{ opacity: 0.8, letterSpacing: '0.04em' }}>{church.subtitle}</span>
            </div>
            <Link to="/notificacoes" className="icon-btn" aria-label="Notificações">
              <Bell />
            </Link>
            {user ? (
              <Link to="/perfil" aria-label="Meu perfil">
                <Avatar name={user.name} picture={user.picture} size={38} />
              </Link>
            ) : (
              <Link className="btn btn-glass btn-sm" to="/entrar">
                Entrar
              </Link>
            )}
          </div>
          <h1>{user ? `${greeting()}, ${firstName(user.name)}!` : church.name}</h1>
          <p className="sub">
            {user ? church.name : `Seja bem-vindo! Cultos aos ${weekdaysPhrase(schedule.map((c) => c.weekday))}, com o ${church.pastor_display}.`}
          </p>
        </div>
      </header>

      <main className="wrap stack-lg lift" style={{ paddingBottom: 28 }}>
        {user && user.status === 'pendente' && (
          <Link to="/aguardando" className="card card-pad card-link row">
            <div className="icon-tile gold">
              <Clock />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>Seu cadastro está em análise</div>
              <div className="small muted">Complete seus dados enquanto a liderança aprova.</div>
            </div>
            <ChevronRight className="chev" />
          </Link>
        )}

        {data?.live.active && (
          <Link to="/ao-vivo" className="live-banner">
            <span className="badge live" style={{ background: 'rgba(255,255,255,0.18)' }}>
              AO VIVO
            </span>
            <div className="grow">
              <div className="t ellipsis">{data.live.title || 'Culto ao vivo'}</div>
              <div className="small" style={{ opacity: 0.9 }}>
                Toque para assistir agora
              </div>
            </div>
            <ChevronRight />
          </Link>
        )}

        {data ? <NextCultCard cults={data.next_cults} church={church} now={now} /> : <Skeleton h={180} r={18} />}

        {data?.pastor && <PastorHomeCard m={data.pastor} today={data.today} />}

        <nav className="quick" aria-label="Atalhos">
          {quick.map((q) => (
            <Link key={q.to + q.label} to={q.to}>
              <span className={`icon-tile ${q.tone}`}>{q.icon}</span>
              {q.label}
            </Link>
          ))}
        </nav>

        <BibleShortcut />

        <InstallBanner />

        {isLeader && pendingTotal > 0 && data?.pending && (
          <Link to={data.pending.help === pendingTotal ? '/ajuda?filtro=pendentes' : '/admin'} className="card card-pad card-link row">
            <div className="icon-tile">
              <ShieldCheck />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>Tarefas da liderança</div>
              <div className="small muted">
                {[
                  data.pending.users && `${data.pending.users} cadastro(s) para aprovar`,
                  data.pending.testimonies && `${data.pending.testimonies} testemunho(s)`,
                  data.pending.visitors && `${data.pending.visitors} visitante(s)`,
                  data.pending.requests && `${data.pending.requests} pedido(s) para grupos`,
                  data.pending.help && `${data.pending.help} no mural de ajuda`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </div>
            <span className="count-pill">{pendingTotal}</span>
          </Link>
        )}

        {data?.word && (
          <Link to={`/palavra/${data.word.id}`} className="word-card">
            <div className="kicker">Palavra do dia</div>
            <h3>{data.word.title}</h3>
            {data.word.verse && <p className="verse mt-2 clamp-3">{data.word.verse}</p>}
            {data.word.reference && (
              <div className="small mt-1" style={{ fontWeight: 650, color: 'var(--gold)' }}>
                {data.word.reference}
              </div>
            )}
          </Link>
        )}

        {data && data.campaigns.length > 0 && (
          <Section title="Campanhas" action={<Link to="/campanhas">Ver todas</Link>}>
            <div className="stack">
              {data.campaigns.map((k) => (
                <div key={k.id} className="card card-pad row">
                  <div className="icon-tile gold">
                    <Sparkles />
                  </div>
                  <Link to={`/campanhas/${k.id}`} className="grow" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <div style={{ fontWeight: 650 }}>{k.title}</div>
                    <div className="small muted clamp-2">{k.daily_goal || 'Toque para ver a campanha'}</div>
                  </Link>
                  <Button variant={k.done_today ? 'ok' : 'secondary'} size="sm" icon={<Check />} onClick={() => void checkin(k.id)}>
                    {k.done_today ? 'Feito' : 'Hoje'}
                  </Button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {data && data.notices.length > 0 && (
          <Section title="Avisos" action={<Link to="/avisos">Ver todos</Link>}>
            <div className="stack">
              {data.notices.slice(0, 3).map((n) => (
                <NoticeCard key={n.id} n={n} />
              ))}
            </div>
          </Section>
        )}

        {data && data.events.length > 0 && (
          <Section title="Próximos eventos" action={<Link to="/agenda">Agenda</Link>}>
            <div className="stack">
              {data.events.map((e) => (
                <EventCard key={e.id} e={e} />
              ))}
            </div>
          </Section>
        )}

        {isMember ? (
          data &&
          data.photos.length > 0 && (
            <Section title="Fotos recentes" action={<Link to="/fotos">Biblioteca</Link>}>
              <div className="photo-grid">
                {data.photos.slice(0, 9).map((p) => (
                  <Link key={p.id} to={p.album_id ? `/fotos/album/${p.album_id}` : '/fotos'} style={{ aspectRatio: '1', display: 'block', background: 'var(--surface-3)' }}>
                    <MediaImg id={p.thumb_id} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </Link>
                ))}
              </div>
            </Section>
          )
        ) : (
          <Link to="/fotos" className="card card-pad card-link row">
            <div className="icon-tile">
              <Images />
            </div>
            <div className="grow">
              <div style={{ fontWeight: 650 }}>Biblioteca de fotos</div>
              <div className="small muted">Os membros compartilham as fotos dos cultos e eventos. Entre para ver.</div>
            </div>
            <ChevronRight className="chev" />
          </Link>
        )}

        {data && data.videos.length > 0 && (
          <Section title={videoNovo ? 'Vídeo novo' : 'Vídeos'} action={<Link to="/videos">Ver todos</Link>}>
            <div className="stack">
              {videoNovo && <VideoHighlight v={videoNovo} />}
              {(videoNovo ? data.videos.slice(1) : data.videos).length > 0 && (
                <div className="hscroll">
                  {(videoNovo ? data.videos.slice(1) : data.videos).map((v) => (
                    <VideoCard key={v.id} v={v} />
                  ))}
                </div>
              )}
            </div>
          </Section>
        )}

        {data && data.birthdays.length > 0 && (
          <Section title="Aniversariantes da semana" action={<Link to="/aniversariantes">Do mês</Link>}>
            <div className="card">
              <div className="list">
                {data.birthdays.map((b) => {
                  const [m, d] = b.md.split('-').map(Number);
                  return (
                    <div key={b.id} className="list-item" style={{ cursor: 'default' }}>
                      <Avatar name={b.name} picture={b.picture} />
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{b.name}</div>
                        <div className="small muted">{b.today ? 'Hoje!' : `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`}</div>
                      </div>
                      {b.today && (
                        <span className="badge gold">
                          <Gift size={13} /> Parabéns
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Section>
        )}

        {!isMember && (
          <div className="card card-pad stack" style={{ background: 'var(--gold-soft)' }}>
            <div className="row">
              <div className="icon-tile gold">
                <UserPlus />
              </div>
              <div className="grow">
                <div style={{ fontWeight: 650 }}>Primeira vez na IRN?</div>
                <div className="small" style={{ color: 'var(--ink-2)' }}>
                  Deixe seu cartão de visitante. Queremos te conhecer e orar por você.
                </div>
              </div>
            </div>
            <Link className="btn btn-navy" to="/visitante">
              Preencher cartão do visitante
            </Link>
          </div>
        )}

        {data && (
          <div className="center">
            <button className="link-btn tiny" onClick={() => void reload()}>
              Atualizar a página inicial
            </button>
          </div>
        )}
      </main>
    </>
  );
}
