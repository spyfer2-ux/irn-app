/* App da IRN — service worker: funciona offline (telas já abertas e livros da Bíblia já lidos), deixa as fotos rápidas e recebe as notificações. */
const VERSION = 'irn-v1';
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const MEDIA = 'irn-media';
const MEDIA_MAX = 400;
const BIBLE = 'irn-biblia'; // livros da Bíblia já abertos (não muda entre versões do app)

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/icons/icon-192.png']))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('irn-v') && !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Fotos e capas: guardadas no aparelho depois da primeira vez (os arquivos nunca mudam).
  if (url.pathname.startsWith('/api/media/') && !req.headers.has('range') && !url.search.includes('baixar')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(MEDIA);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        const type = res.headers.get('content-type') || '';
        if (res.ok && type.startsWith('image/')) {
          cache.put(req, res.clone()).then(() => trim(MEDIA, MEDIA_MAX));
        }
        return res;
      })(),
    );
    return;
  }

  // Bíblia: cada livro aberto fica guardado no aparelho (depois funciona sem internet).
  if (url.pathname.startsWith('/biblia/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(BIBLE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && (res.headers.get('content-type') || '').includes('json')) await cache.put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return; // dados sempre da internet

  // Telas: internet primeiro; sem internet, a última versão guardada.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // Sempre pergunta ao servidor (sem usar o cache do navegador), para a tela nova chegar logo depois de cada atualização.
          const res = await fetch(req.url, { cache: 'no-cache', credentials: 'include' });
          if (res.ok) (await caches.open(SHELL)).put('/', res.clone());
          return res;
        } catch {
          return (await caches.match('/')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Arquivos do app (com nome versionado): do aparelho primeiro.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })(),
    );
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'IRN', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'App da IRN';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/api/brand/icon-192.png',
      badge: '/icons/badge-72.png',
      tag: data.tag || undefined,
      data: { url: data.url || '/' },
      lang: 'pt-BR',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target).catch(() => undefined);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
