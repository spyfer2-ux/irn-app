/** A igreja (endereço, horários, contatos), cartão do visitante e privacidade. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, ThumbsUp, Globe2, HandHeart, AtSign, MapPin, MessageCircle, Navigation, Radio, UserPlus, MonitorPlay } from 'lucide-react';
import { useSession } from '../lib/session';
import { api } from '../lib/api';
import { hourLabel, WEEKDAYS } from '../lib/format';
import { Button, Page, Section, TextField, Toggle, useAction } from '../components/ui';

export default function ChurchPage() {
  const { church, schedule } = useSession();
  const fullAddress = `${church.address}${church.district ? `, ${church.district}` : ''}, ${church.city}${church.cep ? `, ${church.cep}` : ''}`;
  const embed = `https://www.google.com/maps?q=${encodeURIComponent(fullAddress)}&output=embed`;
  const links = [
    church.whatsapp && { href: `https://wa.me/${church.whatsapp}?text=${encodeURIComponent('Graça e paz! Vim pelo app da IRN.')}`, icon: <MessageCircle />, label: 'WhatsApp da igreja', sub: 'Fale com a gente' },
    church.instagram && { href: `https://instagram.com/${church.instagram}`, icon: <AtSign />, label: `@${church.instagram}`, sub: 'Instagram da sede' },
    church.instagram_youth && { href: `https://instagram.com/${church.instagram_youth}`, icon: <AtSign />, label: `@${church.instagram_youth}`, sub: 'Rede Jovem' },
    church.instagram_missions && { href: `https://instagram.com/${church.instagram_missions}`, icon: <Globe2 />, label: `@${church.instagram_missions}`, sub: 'Missões — Moçambique' },
    church.youtube_url && { href: church.youtube_url, icon: <MonitorPlay />, label: 'YouTube', sub: 'Cultos e pregações' },
    church.facebook && { href: `https://facebook.com/${church.facebook}`, icon: <ThumbsUp />, label: 'Facebook', sub: church.facebook },
  ].filter(Boolean) as { href: string; icon: React.JSX.Element; label: string; sub: string }[];

  return (
    <Page title="A igreja">
      <div className="stack-lg">
        <div className="card card-pad stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <img src="/api/brand/logo" alt={`Logo ${church.short}`} width={96} height={96} style={{ borderRadius: 999, boxShadow: 'var(--shadow-2)' }} />
          <div>
            <h1 style={{ fontSize: 24 }}>{church.name}</h1>
            <div className="muted mt-1">
              {church.short} · {church.subtitle}
            </div>
          </div>
          <div className="badge gold" style={{ height: 30, fontSize: 13.5, padding: '0 14px' }}>
            {church.pastor_title} {church.pastor_name}
          </div>
          {church.about && (
            <p className="pre" style={{ color: 'var(--ink-2)', textAlign: 'left' }}>
              {church.about}
            </p>
          )}
        </div>

        <Section title="Onde estamos">
          <div className="card card-pad stack">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="icon-tile">
                <MapPin />
              </div>
              <div className="grow">
                <div style={{ fontWeight: 650 }}>{church.address}</div>
                <div className="small muted">
                  {[church.district, church.city, church.cep && `CEP ${church.cep}`].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <iframe className="map-frame" src={embed} title="Mapa da igreja" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <a className="btn btn-primary btn-sm" href={church.maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noopener noreferrer">
                <Navigation /> Google Maps
              </a>
              <a className="btn btn-secondary btn-sm" href={`https://waze.com/ul?q=${encodeURIComponent(fullAddress)}&navigate=yes`} target="_blank" rel="noopener noreferrer">
                Waze
              </a>
              <a className="btn btn-secondary btn-sm" href={`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[formatted_address]=${encodeURIComponent(fullAddress)}`} target="_blank" rel="noopener noreferrer">
                Uber
              </a>
            </div>
          </div>
        </Section>

        <Section title="Cultos">
          <div className="card">
            <div className="list">
              {schedule.map((s) => (
                <div key={s.id} className="list-item" style={{ cursor: 'default' }}>
                  <div className="icon-tile">
                    <Clock />
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
              <Link to="/ao-vivo" className="list-item">
                <div className="icon-tile live">
                  <Radio />
                </div>
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>Não pode vir?</div>
                  <div className="small muted">Assista ao vivo pelo app</div>
                </div>
              </Link>
            </div>
          </div>
        </Section>

        <Section title="Fale com a gente">
          <div className="card">
            <div className="list">
              {links.map((l) => (
                <a key={l.href} className="list-item" href={l.href} target="_blank" rel="noopener noreferrer">
                  <div className="icon-tile">{l.icon}</div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{l.label}</div>
                    <div className="small muted">{l.sub}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </Section>

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Link className="btn btn-navy grow" to="/visitante">
            <UserPlus /> Cartão do visitante
          </Link>
          <Link className="btn btn-secondary grow" to="/oracao">
            <HandHeart /> Pedir oração
          </Link>
        </div>
        <div className="center">
          <Link to="/privacidade" className="small">
            Privacidade e uso dos dados
          </Link>
        </div>
      </div>
    </Page>
  );
}

export function VisitorCard() {
  const { church } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [hood, setHood] = useState('');
  const [first, setFirst] = useState(true);
  const [how, setHow] = useState('');
  const [prayer, setPrayer] = useState('');
  const [contact, setContact] = useState(true);
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [sent, setSent] = useState(false);
  const { busy, run } = useAction();

  if (sent)
    return (
      <Page title="Cartão do visitante" back="/">
        <div className="card card-pad stack center" style={{ alignItems: 'center' }}>
          <div className="icon-tile gold" style={{ width: 60, height: 60, borderRadius: 20 }}>
            <HandHeart />
          </div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 560 }}>Que alegria ter você aqui!</h2>
          <p style={{ color: 'var(--ink-2)' }}>Recebemos seu cartão. A equipe de recepção da {church.short} vai orar por você{contact && phone ? ' e entrar em contato' : ''}.</p>
          <Link className="btn btn-primary" to="/">
            Voltar ao início
          </Link>
        </div>
      </Page>
    );

  return (
    <Page title="Cartão do visitante" back="/">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api('/visitantes', {
              method: 'POST',
              body: { name, phone, neighborhood: hood, first_time: first, how_found: how, prayer, wants_contact: contact && !!phone, consent, website: trap },
            });
            setSent(true);
          });
        }}
      >
        <p style={{ color: 'var(--ink-2)' }}>Seja bem-vindo à {church.short}! Deixe seus dados para que possamos te conhecer e orar por você.</p>
        <TextField label="Seu nome" value={name} onChange={setName} required maxLength={120} autoComplete="name" />
        <TextField label="WhatsApp (opcional)" value={phone} onChange={setPhone} maxLength={30} inputMode="tel" autoComplete="tel" placeholder="(11) 90000-0000" />
        <TextField label="Bairro (opcional)" value={hood} onChange={setHood} maxLength={80} />
        <Toggle label="É minha primeira vez na igreja" checked={first} onChange={setFirst} />
        <TextField label="Como conheceu a igreja? (opcional)" value={how} onChange={setHow} maxLength={200} placeholder="Ex.: convite de um amigo, Instagram…" />
        <TextField label="Pedido de oração (opcional)" value={prayer} onChange={setPrayer} multiline rows={3} maxLength={1500} />
        {phone && <Toggle label="Quero receber uma mensagem da igreja" checked={contact} onChange={setContact} />}
        <input type="text" value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -5000, width: 1, height: 1 }} />
        <Toggle
          label="Autorizo a igreja a guardar estes dados para entrar em contato comigo."
          hint={<Link to="/privacidade">Como usamos seus dados</Link>}
          checked={consent}
          onChange={setConsent}
        />
        <Button type="submit" loading={busy} disabled={!name.trim() || (!!phone && !consent)}>
          Enviar cartão
        </Button>
      </form>
    </Page>
  );
}

export function Privacy() {
  const { church } = useSession();
  return (
    <Page title="Privacidade" back>
      <article className="card card-pad stack prose" style={{ color: 'var(--ink-2)' }}>
        <h2 style={{ color: 'var(--ink)', fontSize: 19 }}>Como o app da {church.short} usa seus dados</h2>
        <p>
          Este aplicativo é do {church.name}. Seguimos a Lei Geral de Proteção de Dados (LGPD) e usamos as suas informações só para o cuidado e a
          comunicação da igreja.
        </p>
        <h3 style={{ color: 'var(--ink)', fontSize: 16 }}>O que guardamos</h3>
        <p>
          Do login com o Google: nome, e-mail e foto do perfil. O que você preencher no perfil: telefone, aniversário, bairro e informações de membro.
          Também guardamos o que você publicar (fotos, pedidos de oração, testemunhos), suas confirmações em eventos e os registros de contribuição
          que você fizer.
        </p>
        <h3 style={{ color: 'var(--ink)', fontSize: 16 }}>Quem vê</h3>
        <p>
          A biblioteca de fotos, o mural de oração e os testemunhos são vistos apenas por membros aprovados. Pedidos marcados como "só a liderança"
          são vistos apenas pela liderança. Os registros de dízimos e ofertas e os comprovantes são vistos só por você e pela administração. Seu
          aniversário (dia e mês) aparece para os membros, se você deixar essa opção ligada no perfil.
        </p>
        <h3 style={{ color: 'var(--ink)', fontSize: 16 }}>Fotos</h3>
        <p>
          Ao enviar uma foto, você confirma que as pessoas que aparecem concordam. Fotos de crianças só com autorização dos responsáveis. Se você
          aparece em alguma foto e quer que ela saia, fale com a liderança: ela será removida.
        </p>
        <h3 style={{ color: 'var(--ink)', fontSize: 16 }}>Seus direitos</h3>
        <p>
          Você pode corrigir seus dados no perfil e excluir a sua conta a qualquer momento (Perfil → Excluir minha conta). Registros financeiros já
          conferidos podem ser mantidos pela tesouraria para fins de prestação de contas.
        </p>
        <p>Dúvidas: fale com a liderança pelo WhatsApp da igreja.</p>
      </article>
    </Page>
  );
}
