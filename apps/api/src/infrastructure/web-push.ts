import { SignJWT, importJWK } from 'jose';
import type { PushMessage, PushResult, PushSender, PushTarget } from '../domain/campus-ports';

// Web Push (RFC 8030) with an encrypted payload (RFC 8291, aes128gcm) and VAPID (RFC 8292), on
// Web Crypto only, so it runs the same in the Worker and in Node. The browser's push service
// (Google, Mozilla, Apple) keeps the message and wakes the phone's browser to show it, so a
// reminder arrives even when the site, or the browser itself, is closed.

type Bytes = Uint8Array<ArrayBuffer>;
const textEncoder = new TextEncoder();
const utf8 = (s: string): Bytes => new Uint8Array(textEncoder.encode(s));

export function fromB64url(s: string): Bytes {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, bytes: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8),
  );
}

/** Encrypts a message for one browser (RFC 8291). Returns the request body. */
export async function encryptPayload(target: Pick<PushTarget, 'p256dh' | 'auth'>, plaintext: Bytes) {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  const local = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey('raw', local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: uaKey } as EcdhKeyDeriveParams,
      local.privateKey,
      256,
    ),
  );
  const ikm = await hkdf(authSecret, shared, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // One record: the message, then the 0x02 "last record" delimiter.
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))),
  );
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

/** A new VAPID key pair, base64url (for `pnpm ops push:keys`). */
export async function generateVapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pub = concat(new Uint8Array([4]), fromB64url(jwk.x!), fromB64url(jwk.y!));
  return { publicKey: toB64url(pub), privateKey: jwk.d! };
}

/** Sends through the real push services, signed with the site's VAPID keys. */
export class VapidPushSender implements PushSender {
  private signing: Promise<CryptoKey | Uint8Array> | null = null;
  private tokens = new Map<string, { jwt: string; until: number }>();

  constructor(
    readonly publicKey: string,
    private readonly privateKey: string,
    /** mailto: or https: contact the push services can reach if something goes wrong. */
    private readonly subject: string,
    private readonly fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private key() {
    if (!this.signing) {
      const pub = fromB64url(this.publicKey);
      this.signing = importJWK(
        {
          kty: 'EC',
          crv: 'P-256',
          x: toB64url(pub.slice(1, 33)),
          y: toB64url(pub.slice(33, 65)),
          d: this.privateKey,
        },
        'ES256',
      );
    }
    return this.signing;
  }

  /** One signed token per push service, reused for 12 hours. */
  private async token(endpoint: string) {
    const aud = new URL(endpoint).origin;
    const now = Date.now();
    const hit = this.tokens.get(aud);
    if (hit && hit.until > now + 60_000) return hit.jwt;
    const exp = Math.floor(now / 1000) + 12 * 3600;
    const jwt = await new SignJWT({ aud, sub: this.subject })
      .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
      .setExpirationTime(exp)
      .sign(await this.key());
    this.tokens.set(aud, { jwt, until: exp * 1000 });
    return jwt;
  }

  async send(target: PushTarget, message: PushMessage, ttlSeconds: number): Promise<PushResult> {
    const body = await encryptPayload(target, utf8(JSON.stringify(message)));
    const res = await this.fetcher(target.endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${await this.token(target.endpoint)}, k=${this.publicKey}`,
        'content-encoding': 'aes128gcm',
        'content-type': 'application/octet-stream',
        ttl: String(ttlSeconds),
        urgency: 'high',
        // A newer message with the same topic replaces one still waiting on the push service.
        topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'ss',
      },
      body,
    });
    if (res.ok) return 'ok';
    // 404/410: the student turned notifications off or the browser dropped this address.
    if (res.status === 404 || res.status === 410) return 'gone';
    console.error(
      JSON.stringify({
        level: 'warn',
        event: 'push.failed',
        status: res.status,
        text: (await res.text()).slice(0, 200),
      }),
    );
    return 'failed';
  }
}

/** Demo and tests: keeps what would have been sent. */
export class MemoryPushSender implements PushSender {
  readonly sent: { endpoint: string; message: PushMessage }[] = [];
  readonly gone = new Set<string>();
  constructor(readonly publicKey = 'BDemoPublicKeyForTests') {}
  async send(target: PushTarget, message: PushMessage): Promise<PushResult> {
    if (this.gone.has(target.endpoint)) return 'gone';
    this.sent.push({ endpoint: target.endpoint, message });
    return 'ok';
  }
}
