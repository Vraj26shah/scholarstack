import { nativePush, nativeShown, nativeToken } from '../../lib/native-push';
// The browser's side of reminders: can this device get them, ask permission, and subscribe
// through the site's service worker (which shows them, even with the site and browser closed).

export type PushSupport =
  /** Ready to ask. */
  | 'ok'
  /** iPhone/iPad in Safari: reminders only work from the home-screen app. */
  | 'ios-install'
  /** The student (or the browser) blocked notifications for this site. */
  | 'blocked'
  /** This browser can't do push at all (or the page isn't on https). */
  | 'unsupported';

export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export function pushSupport(): PushSupport {
  // Inside the Android apps notifications come through Firebase, always available.
  if (nativePush()) return 'ok';
  if (typeof window === 'undefined' || !window.isSecureContext) return 'unsupported';
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'ios-install';
  if (!capable) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return 'ok';
}

const keyBytes = (b64url: string) => {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration> {
  // The live site registers /sw.js on load; the demo and first visits may not have it yet.
  if (!(await navigator.serviceWorker.getRegistration('/')))
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

/** This browser's current push subscription, if any (never asks for anything). */
export async function browserSubscription(): Promise<{ endpoint: string } | null> {
  if (nativePush()) {
    const token = await nativeToken(false).catch(() => null);
    return token ? { endpoint: `fcm:${token}` } : null;
  }
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export class PermissionRefused extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(permission === 'denied' ? 'blocked' : 'dismissed');
  }
}

/** Shows the browser's own "Allow notifications?" and subscribes. */
export async function subscribeBrowser(publicKey: string) {
  // The Android apps: the phone's Firebase token is the address (no Web Push keys).
  if (nativePush()) {
    try {
      const token = await nativeToken(true);
      if (!token) throw new PushUnavailable(new Error('No notification token'));
      return { endpoint: `fcm:${token}`, keys: { p256dh: '', auth: '' } };
    } catch (e) {
      const permission = (e as { permission?: string }).permission;
      if (permission) throw new PermissionRefused(permission === 'denied' ? 'denied' : 'default');
      throw e instanceof PushUnavailable ? e : new PushUnavailable(e);
    }
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new PermissionRefused(permission);
  const reg = await registration();
  const key = keyBytes(publicKey);
  let sub = await reg.pushManager.getSubscription();
  // Made with other keys (an old setup): replace it, or our pushes would be refused.
  const current = sub?.options.applicationServerKey;
  if (sub && current && new Uint8Array(current).join() !== key.join()) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    const ask = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    try {
      sub = await ask();
    } catch (first) {
      // Often a half-made subscription left by an earlier try (or a key change): clear it, try again.
      await (await reg.pushManager.getSubscription().catch(() => null))?.unsubscribe().catch(() => {});
      try {
        sub = await ask();
      } catch (second) {
        throw new PushUnavailable(second ?? first);
      }
    }
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new PushUnavailable(new Error('The browser gave an incomplete push address.'));
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

const isBrave = () => !!(navigator as Navigator & { brave?: unknown }).brave;

/** The browser refused to make a push address: says why, in words a person can act on. */
export class PushUnavailable extends Error {
  constructor(readonly reason: unknown) {
    const raw = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    super(
      isBrave()
        ? 'Brave blocks notifications by default. Open brave://settings/privacy, turn on "Use Google services for push messaging", restart Brave and try again.'
        : /push service|AbortError/i.test(raw)
          ? "This browser couldn't reach its notification service. Check you're online and not in a private (incognito) window, then try again, or use Chrome."
          : /InvalidStateError|NotAllowedError/i.test(raw)
            ? 'The browser refused. Reload the page and try again; if it keeps happening, allow notifications for this site in the browser settings.'
            : `The browser couldn't turn on notifications (${raw.slice(0, 120)}). Reload the page and try again.`,
    );
    this.name = 'PushUnavailable';
  }
}

/**
 * Waits for this device's service worker to say it showed a notification with this tag: 'shown',
 * 'failed' (the browser refused to show it), or 'timeout' (it never arrived).
 */
export function waitForShown(tag: string, ms = 15_000): Promise<'shown' | 'failed' | 'timeout'> {
  if (nativePush()) return nativeShown(tag, ms);
  return new Promise((resolve) => {
    if (!('serviceWorker' in navigator)) return resolve('timeout');
    const done = (r: 'shown' | 'failed' | 'timeout') => {
      clearTimeout(timer);
      navigator.serviceWorker.removeEventListener('message', on);
      resolve(r);
    };
    const on = (e: MessageEvent) => {
      if (e.data?.tag !== tag) return;
      if (e.data.type === 'shown') done('shown');
      if (e.data.type === 'show-failed') done('failed');
    };
    const timer = setTimeout(() => done('timeout'), ms);
    navigator.serviceWorker.addEventListener('message', on);
  });
}

export async function unsubscribeBrowser() {
  // The app keeps its Firebase token; the server forgets the device instead.
  if (nativePush()) return;
  const reg = await navigator.serviceWorker?.getRegistration('/').catch(() => undefined);
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => {});
}
