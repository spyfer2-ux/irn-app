import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';
import { SessionProvider } from './lib/session';
import { Layout } from './components/Layout';
import { LoadingList } from './components/ui';
import Home from './pages/Home';
import LivePage, { LiveHistory } from './pages/Live';
import Videos, { VideoDetail } from './pages/Videos';
import Photos, { AlbumPage } from './pages/Photos';
import Agenda, { EventDetail } from './pages/Agenda';
import { Notices, WordDetail, Words } from './pages/Content';
import { PrayerPage, TestimoniesPage } from './pages/Care';
import { CampaignDetail, Campaigns, Ministries } from './pages/Groups';
import ChurchPage, { Privacy, VisitorCard } from './pages/Church';
import BiblePage, { BibleChapter } from './pages/Bible';
import { HelpBoard, PastorDetail, PastorMessages, SermonDetail, Sermons } from './pages/Extras';
import Scenes, { SceneDetail } from './pages/Scenes';
import { MarkedVerses } from './pages/BibleMarks';
import { Birthdays, Inbox, Login, More, NotFound, Pending, Profile } from './pages/Account';

const Giving = lazy(() => import('./pages/Giving'));
const admin = () => import('./pages/Admin');
const AdminHome = lazy(() => admin().then((m) => ({ default: m.AdminHome })));
const AdminMembers = lazy(() => admin().then((m) => ({ default: m.AdminMembers })));
const AdminBirthdays = lazy(() => admin().then((m) => ({ default: m.AdminBirthdays })));
const AdminVisitors = lazy(() => admin().then((m) => ({ default: m.AdminVisitors })));
const AdminRequests = lazy(() => admin().then((m) => ({ default: m.AdminRequests })));
const AdminNotify = lazy(() => admin().then((m) => ({ default: m.AdminNotify })));
const AdminContributions = lazy(() => admin().then((m) => ({ default: m.AdminContributions })));
const AdminReports = lazy(() => admin().then((m) => ({ default: m.AdminReports })));
const AdminAudit = lazy(() => admin().then((m) => ({ default: m.AdminAudit })));
const AdminConfig = lazy(() => admin().then((m) => ({ default: m.AdminConfig })));

try {
  const theme = localStorage.getItem('irn-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch {
  /* sem armazenamento local */
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

const fallback = (
  <div className="wrap page">
    <LoadingList n={3} />
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <Layout>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/ao-vivo" element={<LivePage />} />
              <Route path="/ao-vivo/historico" element={<LiveHistory />} />
              <Route path="/videos" element={<Videos />} />
              <Route path="/videos/:id" element={<VideoDetail />} />
              <Route path="/fotos" element={<Photos />} />
              <Route path="/fotos/album/:id" element={<AlbumPage />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/agenda/:id" element={<EventDetail />} />
              <Route path="/avisos" element={<Notices />} />
              <Route path="/palavra" element={<Words />} />
              <Route path="/palavra/:id" element={<WordDetail />} />
              <Route path="/mensagem" element={<PastorMessages />} />
              <Route path="/mensagem/:id" element={<PastorDetail />} />
              <Route path="/cenas" element={<Scenes />} />
              <Route path="/cenas/:id" element={<SceneDetail />} />
              <Route path="/pregacoes" element={<Sermons />} />
              <Route path="/pregacoes/:id" element={<SermonDetail />} />
              <Route path="/ajuda" element={<HelpBoard />} />
              <Route path="/biblia" element={<BiblePage />} />
              <Route path="/biblia/marcados" element={<MarkedVerses />} />
              <Route path="/biblia/:livro/:cap" element={<BibleChapter />} />
              <Route path="/oracao" element={<PrayerPage />} />
              <Route path="/testemunhos" element={<TestimoniesPage />} />
              <Route path="/campanhas" element={<Campaigns />} />
              <Route path="/campanhas/:id" element={<CampaignDetail />} />
              <Route path="/grupos" element={<Ministries />} />
              <Route path="/dizimos" element={<Giving />} />
              <Route path="/igreja" element={<ChurchPage />} />
              <Route path="/visitante" element={<VisitorCard />} />
              <Route path="/privacidade" element={<Privacy />} />
              <Route path="/perfil" element={<Profile />} />
              <Route path="/notificacoes" element={<Inbox />} />
              <Route path="/aniversariantes" element={<Birthdays />} />
              <Route path="/entrar" element={<Login />} />
              <Route path="/aguardando" element={<Pending />} />
              <Route path="/mais" element={<More />} />
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/membros" element={<AdminMembers />} />
              <Route path="/admin/aniversariantes" element={<AdminBirthdays />} />
              <Route path="/admin/visitantes" element={<AdminVisitors />} />
              <Route path="/admin/pedidos" element={<AdminRequests />} />
              <Route path="/admin/notificar" element={<AdminNotify />} />
              <Route path="/admin/contribuicoes" element={<AdminContributions />} />
              <Route path="/admin/relatorios" element={<AdminReports />} />
              <Route path="/admin/auditoria" element={<AdminAudit />} />
              <Route path="/admin/config" element={<AdminConfig />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
