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
export async function browserSubscription(): Promise<PushSubscription | null> {
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
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const json = sub.toJSON();
  return { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } };
}

export async function unsubscribeBrowser() {
  const sub = await browserSubscription().catch(() => null);
  await sub?.unsubscribe().catch(() => {});
}
