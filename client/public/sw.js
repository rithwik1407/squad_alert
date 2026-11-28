/* SquadSync service worker: web push (FCM data messages) + light offline shell. */
const CACHE = 'squadsync-v7';
const SHELL = ['/', '/manifest.webmanifest', '/icons/rare-icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    // Network first for pages so deploys show up; fall back to the cached shell offline.
    e.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/maps/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      })),
    );
  }
});

// FCM sends { data: { title, body, url, matchId, tag } }.
self.addEventListener('push', (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { data: { title: 'SquadSync', body: e.data && e.data.text() } }; }
  const d = payload.data || payload.notification || {};
  const title = d.title || 'SquadSync';
  // If SquadSync is open on screen, the page plays the louder SquadSync alert sound too.
  const ring = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((wins) => wins.forEach((w) => w.postMessage({ type: 'squadsync-alert', title, body: d.body || '' })))
    .catch(() => {});
  e.waitUntil(Promise.all([ring,
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icons/rare-icon-192.png',
      badge: '/icons/badge-96.png',
      tag: d.tag || 'squadsync',
      renotify: true,
      requireInteraction: true,
      silent: false,
      // Long, distinctive buzz so it doesn't feel like a normal message.
      vibrate: [400, 120, 400, 120, 400, 250, 900],
      data: { url: d.url || '/', matchId: d.matchId || null, inviteId: d.inviteId || null },
      // Classic-match invite: answer straight from the notification.
      actions: /^classic-[a-f0-9]{24}$/.test(d.tag || '')
        ? [{ action: 'in', title: "✅ I'm in" }, { action: 'out', title: "❌ I'm out" }]
        : (d.tag || '').startsWith('match-')
          ? [{ action: 'join', title: "✅ I'm joining" }, { action: 'bgmi', title: '🎮 Open BGMI' }]
          : [{ action: 'open', title: 'Open' }],
    }),
  ]));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const matchId = e.notification.data && e.notification.data.matchId;
  const inviteId = e.notification.data && e.notification.data.inviteId;
  if ((e.action === 'in' || e.action === 'out') && inviteId) {
    e.waitUntil(
      fetch(`/api/invites/${inviteId}/respond?via=push`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ response: e.action }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(String(r.status));
          // In: open the page with the Open BGMI button, ready to jump into the game.
          if (e.action === 'in') return self.clients.openWindow('/bgmi');
        })
        .catch(() => self.clients.openWindow(`/classic/${inviteId}`)),
    );
    return;
  }
  // Room ID alert: open the page with copy buttons and the Open BGMI button.
  if (e.action === 'bgmi' && matchId) {
    e.waitUntil(self.clients.openWindow(`/bgmi?match=${matchId}`));
    return;
  }
  if (e.action === 'join' && matchId) {
    // Tell the captain without opening the app (same-origin, so the auth cookie is sent).
    e.waitUntil(
      fetch(`/api/matches/${matchId}/joining?via=push`, { method: 'POST', credentials: 'include' })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); })
        .catch(() => self.clients.openWindow(`/matches/${matchId}`)),
    );
    return;
  }
  const target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
