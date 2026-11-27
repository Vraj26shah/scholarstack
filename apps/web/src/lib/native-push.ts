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
}

const plugins = () =>
  (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor?.Plugins ?? {};
const push = () => plugins().PushNotifications as PushPlugin | undefined;
export const phoneSetup = () => plugins().PartnerSetup as SetupPlugin | undefined;

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
    const url = data.url && data.url.startsWith('/') ? data.url : null;
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
