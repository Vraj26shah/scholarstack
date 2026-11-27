import { appMode, isNativeApp } from './app-mode';

/**
 * Notifications inside the Android apps, through Firebase (the app's PushNotifications plugin),
 * instead of the browser's Web Push. The rest of the site doesn't change: push-client.ts asks this
 * module for an address, which is "fcm:<token>", and the server sends to it through Firebase.
 *
 * The plugin is reached through the bridge the app injects (window.Capacitor), so the website
 * itself carries no app code and works the same in a browser.
 */

type Listener = { remove: () => Promise<void> };
interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  createChannel(c: Record<string, unknown>): Promise<void>;
  addListener(event: string, cb: (e: never) => void): Promise<Listener> | Listener;
}
interface SetupPlugin {
  status(): Promise<{ ignoringBattery: boolean; notifications: boolean; maker: string }>;
  askIgnoreBattery(): Promise<void>;
  openAutostart(): Promise<{ opened: boolean }>;
  openNotificationSettings(): Promise<void>;
  setSecure(o: { on: boolean }): Promise<void>;
  phoneKey?(): Promise<{ key: string }>;
}

const plugins = () =>
  (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins ?? {};
const push = () => plugins().PushNotifications as PushPlugin | undefined;
export const phoneSetup = () => plugins().PartnerSetup as SetupPlugin | undefined;

/** The phone's own ID in the student app (older versions: none). Never in the Partner app: owners share phones freely. */
export async function phoneKey(): Promise<string | undefined> {
  if (typeof window === 'undefined' || !isNativeApp() || appMode() !== 'student') return undefined;
  try {
    const key = (await phoneSetup()?.phoneKey?.())?.key ?? '';
    return /^[0-9a-fA-F]{8,64}$/.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Running inside one of the apps, with its notification plugin. */
export const nativePush = () => typeof window !== 'undefined' && isNativeApp() && !!push();

const TOKEN_KEY = 'ss_fcm_token';
const savedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

let waiting: Promise<string> | null = null;

/** The phone's Firebase token, asking for permission first when `ask` (else null if not allowed yet). */
export async function nativeToken(ask: boolean): Promise<string | null> {
  const p = push();
  if (!p) return null;
  let perm = (await p.checkPermissions()).receive;
  if (perm !== 'granted') {
    if (!ask) return null;
    perm = (await p.requestPermissions()).receive;
    if (perm !== 'granted')
      throw Object.assign(new Error(perm === 'denied' ? 'blocked' : 'dismissed'), { permission: perm });
  }
  const known = savedToken();
  if (known && !ask) return known;
  waiting ??= new Promise<string>((resolve, reject) => {
    const done = (fn: () => void) => {
      clearTimeout(timer);
      waiting = null;
      fn();
    };
    const timer = setTimeout(
      () =>
        done(() =>
          reject(new Error('The phone did not give a notification token. Check the internet and try again.')),
        ),
      20_000,
    );
    void p.addListener('registration', ((t: { value: string }) => {
      try {
        localStorage.setItem(TOKEN_KEY, t.value);
      } catch {
        // storage blocked: the token is still used now
      }
      done(() => resolve(t.value));
    }) as (e: never) => void);
    void p.addListener('registrationError', ((e: { error: string }) =>
      done(() => reject(new Error(e.error)))) as (e: never) => void);
    void p.register();
  });
  return waiting;
}

/** Whether notifications are allowed (without asking). */
export async function nativePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  const p = push();
  if (!p) return 'denied';
  const r = (await p.checkPermissions()).receive;
  return r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt';
}

async function receipt(token: string | null, tag: string, event: 'shown' | 'opened') {
  if (!token) return;
  await fetch('/api/push/receipt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: `fcm:${token}`, tag: tag.slice(0, 80), event }),
  }).catch(() => {});
}

let started = false;

/**
 * Once per app start: the notification channels (the Partner app's loud order ring), opening
 * the right screen when a notification is tapped, and telling open pages when one arrives.
 */
export function startNativeApp() {
  if (started || !nativePush()) return;
  started = true;
  const p = push()!;
  if (appMode() === 'partner') {
    void p
      .createChannel({
        id: 'new_orders',
        name: 'New orders',
        description: 'Rings loudly for every new order',
        importance: 5,
        visibility: 1,
        sound: 'order_ring',
        vibration: true,
        lights: true,
        lightColor: '#F5B83D',
      })
      .catch(() => {});
  }
  void p
    .createChannel({
      id: 'general',
      name: 'Updates',
      description: 'Messages, reminders and order updates',
      importance: 4,
      visibility: 1,
      vibration: true,
    })
    .catch(() => {});

  // A notification arrived while the app is open: pages refresh at once (as with the website's
  // service worker messages), and the delivery is counted.
  void p.addListener('pushNotificationReceived', ((n: { data?: Record<string, string> }) => {
    const tag = n.data?.tag ?? '';
    navigator.serviceWorker?.dispatchEvent(new MessageEvent('message', { data: { type: 'push', tag } }));
    window.dispatchEvent(new CustomEvent('ss-native-push', { detail: { tag } }));
    void receipt(savedToken(), tag, 'shown');
  }) as (e: never) => void);
  // Tapped: open its page in the app.
  void p.addListener('pushNotificationActionPerformed', ((a: {
    notification?: { data?: Record<string, string> };
  }) => {
    const data = a.notification?.data ?? {};
    void receipt(savedToken(), data.tag ?? '', 'opened');
    const url = data.url?.startsWith('/') ? data.url : null;
    if (url && url !== window.location.pathname + window.location.search) window.location.assign(url);
  }) as (e: never) => void);
}

/** Resolves when a notification with this tag arrives while the app is open (for "Send a test"). */
export function nativeShown(tag: string, ms: number): Promise<'shown' | 'timeout'> {
  return new Promise((resolve) => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ tag: string }>).detail?.tag !== tag) return;
      clearTimeout(timer);
      window.removeEventListener('ss-native-push', on);
      resolve('shown');
    };
    const timer = setTimeout(() => {
      window.removeEventListener('ss-native-push', on);
      // In the background Android shows it itself; the page can't see that, so assume it did.
      resolve(document.visibilityState === 'visible' ? 'timeout' : 'shown');
    }, ms);
    window.addEventListener('ss-native-push', on);
  });
}

/** Notes on screen in the app: screenshots and screen recording are blocked (Android FLAG_SECURE). */
export const isNotesScreen = (pathname: string) => /^\/(read|c|b)\//.test(pathname);
let secure = false;
export function protectScreen(on: boolean) {
  if (on === secure || !isNativeApp()) return;
  const p = phoneSetup();
  if (!p?.setSecure) return;
  secure = on;
  void p.setSecure({ on }).catch(() => {
    secure = !on;
  });
}

/**
 * The apps' splash. The native one (navy and the logo) hands over to the animated one in
 * index.html as soon as the page shows. Once the app knows who is signed in, and the opening has
 * played (about 1.7 s), it plays backwards: the line, tagline and name leave in reverse order, then
 * the navy folds into the header (the student app's logo tile, the Partner app's header bar) while
 * the logo flies into the header's logo, so the splash becomes the header. Without a header on the
 * screen (sign-in, a loading screen) it simply fades.
 */
let splashGone = false;
const EASE = 'cubic-bezier(.22,1,.36,1)';

export function hideSplash() {
  if (splashGone || typeof window === 'undefined' || !isNativeApp()) return;
  splashGone = true;
  const native = plugins().SplashScreen as
    | { hide?: (o?: { fadeOutDuration?: number }) => Promise<void> }
    | undefined;
  void native?.hide?.({ fadeOutDuration: 0 }).catch(() => {});
  const el = document.getElementById('ss-splash');
  if (!el) return;
  const started = (window as unknown as { __ssSplashAt?: number }).__ssSplashAt ?? Date.now();
  const wait = Math.max(0, 1700 - (Date.now() - started));
  const done = () => {
    el.remove();
    delete document.documentElement.dataset.appSplash;
  };
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    if (reduce || typeof el.animate !== 'function') {
      done();
      return;
    }
    // The header can arrive a moment after the session does: look for it for up to 1.2 s.
    let tries = 0;
    const find = () => {
      const target = document.querySelector<HTMLElement>('[data-splash-target]');
      const box = target?.getBoundingClientRect();
      if (target && box && box.width > 0 && box.top < window.innerHeight) return play(target);
      if (tries++ < 12) window.setTimeout(find, 100);
      else play(null);
    };
    requestAnimationFrame(() => requestAnimationFrame(find));
  }, wait);

  function play(target: HTMLElement | null) {
    const q = <T extends Element>(s: string) => el!.querySelector<T>(s);
    // 1. In reverse: loading line, tagline (or Partner), then the name drop back down and go.
    const out = (node: Element | null, delay: number, y: number) =>
      node?.animate(
        [
          { opacity: getComputedStyle(node).opacity, transform: getComputedStyle(node).transform },
          { opacity: 0, transform: `translate(-50%, ${y}px)` },
        ],
        { duration: 220, delay, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
      );
    q('.ss-bar')?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
    out(q('.ss-tag'), 0, 10);
    out(q('.ss-partner'), 0, 10);
    out(q('.ss-word'), 60, 14);
    for (const g of [q('.ss-glow'), q('.ss-grain')])
      g?.animate([{ opacity: getComputedStyle(g).opacity }, { opacity: 0 }], {
        duration: 420,
        fill: 'forwards',
      });

    const mark = q<SVGSVGElement>('.ss-mark');
    const stage = q<HTMLElement>('.ss-stage');
    const logo = target?.querySelector<SVGSVGElement>('svg.logo-mark') ?? null;
    if (!target || !mark || !stage || !logo) {
      // No header to fold into: the bars fan out once more as everything fades.
      el!
        .animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 380,
          delay: 200,
          easing: EASE,
          fill: 'forwards',
        })
        .finished.then(done, done);
      return;
    }
    // 2. The splash becomes the header: the navy shrinks to the header's shape while the logo
    //    flies into the header's logo.
    const from = mark.getBoundingClientRect();
    const to = logo.getBoundingClientRect();
    const st = stage.getBoundingClientRect();
    stage.style.transformOrigin = `${from.left + from.width / 2 - st.left}px ${from.top + from.height / 2 - st.top}px`;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const s = to.width / from.width;
    const box = target.getBoundingClientRect();
    const radius = Number(target.dataset.splashTarget) || 0;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const shape = `inset(${box.top}px ${W - box.right}px ${H - box.bottom}px ${box.left}px round ${radius}px)`;
    const fly = { duration: 640, delay: 320, easing: EASE, fill: 'forwards' as const };
    mark.animate([{ filter: 'drop-shadow(0 14px 28px rgba(10,14,40,.35))' }, { filter: 'none' }], fly);
    stage.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${s})` }], fly);
    const fold = el!.animate([{ clipPath: 'inset(0px 0px 0px 0px round 0px)' }, { clipPath: shape }], fly);
    // 3. Once it sits exactly on the real header, hand over to it.
    fold.finished
      .then(() =>
        el!
          .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'linear', fill: 'forwards' })
          .finished.then(done),
      )
      .catch(done);
  }
}
