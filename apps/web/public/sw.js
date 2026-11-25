// Scholars Stack offline cache. Small on purpose: it keeps the page shell and the site's own
// code and styles (a few MB at most, capped below), so a repeat visit opens instantly and a
// dropped connection still shows the site. It never stores notes, account data or anything
// from /api: those always come fresh from the network.
const CACHE = 'ss-shell-v1';
const MAX_ASSETS = 40;
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keep only the newest MAX_ASSETS files (old builds' files fall out on their own). */
async function trim(cache) {
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith('/assets/'));
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(old);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  // Built files have a content hash in their name: once fetched they never change.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await cache.put(req, res.clone());
          void trim(cache);
        }
        return res;
      }),
    );
    return;
  }

  // Pages: always ask the network first (so a new release shows at once); offline, use the
  // last shell we saw. The app then shows its own "you're offline" messages.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((c) => c.put(SHELL, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(SHELL)) ?? Response.error()),
    );
  }
});

// ── Reminders (Web Push) ─────────────────────────────────────────────────────
// The server sends a small encrypted message; the browser wakes this worker to show it, even
// when no tab of the site is open. Each kind has one tag, so a new one replaces the last.

// Pushes are handled one at a time, in arrival order. Several arriving together (a burst of chat
// messages, a new order and a message) would otherwise read the same old notification at once and
// the later one would drop the earlier line.
let pushQueue = Promise.resolve();

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Scholars Stack', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Scholars Stack';
  // A chat keeps one notification per order, but the earlier unread lines stay in it (newest last),
  // so someone away from the site still reads the whole conversation from the notification.
  const bodyFor = () =>
    String(data.tag || '').startsWith('chat-')
      ? self.registration
          .getNotifications({ tag: data.tag })
          .then((open) => {
            const earlier = open.length ? String(open[open.length - 1].body || '').split('\n') : [];
            return [...earlier, data.body || ''].filter(Boolean).slice(-5).join('\n');
          })
          .catch(() => data.body || '')
      : Promise.resolve(data.body || '');
  const show = () =>
    bodyFor().then((body) =>
      self.registration.showNotification(title, {
        body,
        tag: data.tag || 'ss',
        renotify: true,
        requireInteraction: !!data.requireInteraction,
        vibrate: data.requireInteraction ? [300, 120, 300, 120, 300] : [120, 60, 120],
        icon: '/apple-touch-icon.png',
        badge: '/favicon.svg',
        lang: 'en-IN',
        data: { url: data.url || '/' },
        actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      }),
    );
  // A chat message for a chat that's open and in front of the person: the page shows it already.
  const handle = () =>
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      const quiet =
        data.quietWhen &&
        tabs.some((t) => t.focused && t.visibilityState === 'visible' && t.url.includes(data.quietWhen));
      if (quiet) {
        for (const t of tabs) t.postMessage({ type: 'push', tag: data.tag || '' });
        return undefined;
      }
      // Shown: tell open pages ("✓ arrived") and the server (the admin sees which devices work).
      return show().then(
        () => {
          for (const t of tabs) t.postMessage({ type: 'shown', tag: data.tag || '' });
          // The receipt never holds up the next notification: at most 4 s.
          const receipt = myEndpoint().then(
            (endpoint) =>
              endpoint &&
              fetch('/api/push/receipt', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // The kind (class, nightly, mess…) is counted for the admin; nothing else is sent.
                body: JSON.stringify({ endpoint, tag: String(data.tag || '').slice(0, 80), event: 'shown' }),
              }).catch(() => {}),
          );
          return Promise.race([receipt, new Promise((r) => setTimeout(r, 4000))]);
        },
        (error) => {
          for (const t of tabs)
            t.postMessage({
              type: 'show-failed',
              tag: data.tag || '',
              error: String(error?.message),
            });
        },
      );
    });
  const run = pushQueue.then(handle, handle).catch(() => {});
  pushQueue = run;
  event.waitUntil(run);
});

/** This device's push address, for "Mute today". */
async function myEndpoint() {
  const sub = await self.registration.pushManager.getSubscription();
  return sub ? sub.endpoint : null;
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  if (event.action === 'mute') {
    event.waitUntil(
      myEndpoint().then(
        (endpoint) =>
          endpoint &&
          fetch('/api/push/mute', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          }).catch(() => {}),
      ),
    );
    return;
  }
  // "Tapped": counted per kind for the admin (never holds up opening the page).
  void myEndpoint().then(
    (endpoint) =>
      endpoint &&
      fetch('/api/push/receipt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, tag: String(n.tag || '').slice(0, 80), event: 'opened' }),
      }).catch(() => {}),
  );
  // Open exactly that page. An open tab of the site is reused: the app inside it moves to the page
  // itself (keeping anything half-typed in other tabs of the app); if it doesn't answer, the tab is
  // navigated; if that fails too (a tab this worker doesn't control), a new window opens.
  const target = new URL(n.data?.url || '/', self.location.origin);
  const path = target.pathname + target.search + target.hash;
  const askApp = (tab) =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      const timer = setTimeout(() => resolve(false), 1200);
      ch.port1.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
      try {
        tab.postMessage({ type: 'open', url: path }, [ch.port2]);
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (tabs) => {
      const mine = tabs.filter((t) => new URL(t.url).origin === self.location.origin);
      // The tab in front first, then the most recent.
      mine.sort((a, b) => Number(b.focused) - Number(a.focused));
      const tab = mine[0];
      if (!tab) return self.clients.openWindow(target.href);
      await tab.focus().catch(() => {});
      if (new URL(tab.url).href === target.href) return undefined;
      if (await askApp(tab)) return undefined;
      return tab
        .navigate(target.href)
        .then((t) => t || self.clients.openWindow(target.href))
        .catch(() => self.clients.openWindow(target.href));
    }),
  );
});

// The browser replaced this device's push address: tell the server, keeping the same settings.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const key = old?.options?.applicationServerKey;
  if (!old || !key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch('/api/push/renew', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON() }),
        }),
      )
      .catch(() => {}),
  );
});
