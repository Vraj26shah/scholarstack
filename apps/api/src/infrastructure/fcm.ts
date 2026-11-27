import { SignJWT, importPKCS8 } from 'jose';
import type { PushMessage, PushResult, PushSender, PushTarget } from '../domain/campus-ports';

/**
 * Notifications to the Android apps through Firebase Cloud Messaging (HTTP v1). An app device is
 * stored like a browser's push address, as "fcm:<token>". Free and unlimited on Google's side; we
 * sign a service-account token once an hour (RS256, Web Crypto) and reuse it.
 *
 * Android shows the notification itself (even with the app closed or the phone locked) on one
 * of the channels the apps create: "new_orders" rings loudly for a restaurant's new orders,
 * "general" is everything else. A tap opens the app on `data.url`.
 */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** The service account from base64 (how the secret is stored) or raw JSON. Null if it isn't one. */
export function readServiceAccount(raw: string): ServiceAccount | null {
  const text = raw.trim();
  if (!text) return null;
  try {
    const json = text.startsWith('{') ? text : atob(text);
    const sa = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof sa.client_email !== 'string' || typeof sa.private_key !== 'string') return null;
    return { client_email: sa.client_email, private_key: sa.private_key, project_id: sa.project_id };
  } catch {
    return null;
  }
}

export const FCM_CHANNELS = { orders: 'new_orders', general: 'general' } as const;

/** Builds the FCM v1 message for one device (exported for tests). */
export function fcmMessage(token: string, message: PushMessage, ttlSeconds: number) {
  const channel = message.requireInteraction ? FCM_CHANNELS.orders : FCM_CHANNELS.general;
  return {
    message: {
      token,
      notification: { title: message.title.slice(0, 120), body: message.body.slice(0, 400) },
      // Everything the app needs when the notification is tapped (strings only in FCM data).
      data: {
        url: message.url,
        tag: message.tag,
        ...(message.quietWhen ? { quietWhen: message.quietWhen } : {}),
      },
      android: {
        priority: 'high',
        ttl: `${Math.max(0, Math.min(2_419_200, Math.round(ttlSeconds)))}s`,
        notification: {
          channel_id: channel,
          tag: message.tag.slice(0, 80),
          // The small icon the apps ship (white silhouette), tinted with the brand colour.
          icon: 'ic_stat_notify',
          color: '#2F3C7E',
          ...(channel === FCM_CHANNELS.orders ? { sound: 'order_ring', default_vibrate_timings: true } : {}),
          notification_priority: channel === FCM_CHANNELS.orders ? 'PRIORITY_MAX' : 'PRIORITY_HIGH',
          visibility: 'PUBLIC',
        },
      },
    },
  };
}

export class FcmPushSender implements PushSender {
  /** Apps don't use a VAPID key. */
  readonly publicKey = '';
  private access: { token: string; until: number } | null = null;
  private signingKey: Promise<CryptoKey> | null = null;

  constructor(
    private readonly projectId: string,
    private readonly account: ServiceAccount,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** An OAuth access token for FCM, cached until a minute before it expires. */
  private async accessToken(): Promise<string> {
    const now = this.now();
    if (this.access && this.access.until > now + 60_000) return this.access.token;
    this.signingKey ??= importPKCS8(this.account.private_key, 'RS256');
    const iat = Math.floor(now / 1000);
    const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setSubject(this.account.client_email)
      .setAudience('https://oauth2.googleapis.com/token')
      .setIssuedAt(iat)
      .setExpirationTime(iat + 3600)
      .sign(await this.signingKey);
    const res = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`FCM sign-in failed (${res.status})`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new Error('FCM sign-in gave no token');
    this.access = { token: body.access_token, until: now + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async send(target: PushTarget, message: PushMessage, ttlSeconds: number): Promise<PushResult> {
    const token = target.endpoint.replace(/^fcm:/, '');
    try {
      const post = async () =>
        this.fetcher(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${await this.accessToken()}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify(fcmMessage(token, message, ttlSeconds)),
          },
        );
      let res = await post();
      if (res.status === 401) {
        // The cached token was revoked or expired early: get a new one and try once more.
        this.access = null;
        res = await post();
      }
      if (res.ok) return 'ok';
      const text = await res.text().catch(() => '');
      // The app was uninstalled or the token replaced: forget this device.
      if (res.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return 'gone';
      if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return 'gone';
      return 'failed';
    } catch {
      return 'failed';
    }
  }
}

/**
 * One sender for every device: app devices (fcm:) go through Firebase, browsers through Web
 * Push. Without Firebase set up, app devices simply fail (and the rest keeps working).
 */
export class SplitPushSender implements PushSender {
  constructor(
    private readonly web: PushSender,
    private readonly app: PushSender | null,
  ) {}
  get publicKey() {
    return this.web.publicKey;
  }
  get appsConfigured() {
    return !!this.app;
  }
  send(target: PushTarget, message: PushMessage, ttlSeconds: number): Promise<PushResult> {
    if (target.endpoint.startsWith('fcm:'))
      return this.app ? this.app.send(target, message, ttlSeconds) : Promise.resolve('failed');
    return this.web.send(target, message, ttlSeconds);
  }
}
