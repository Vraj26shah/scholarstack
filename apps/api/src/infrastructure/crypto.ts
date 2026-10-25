import type { Clock, IdGenerator, TileSeeder, TokenSigner } from '../domain/ports';

const enc = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message)));
}

async function hmacSha256B64(secret: string, message: string): Promise<string> {
  return toBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(message))),
  );
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(message)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  // An empty secret must never match, even an empty header.
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Compact signed tokens: base64url(json).signature, with an `exp` claim. */
export class HmacTokenSigner implements TokenSigner {
  constructor(
    private readonly secret: string,
    private readonly clock: Clock,
  ) {
    if (secret.length < 16) throw new Error('Token signer secret must be at least 16 characters.');
  }

  async sign(payload: Record<string, unknown>, ttlSeconds: number): Promise<string> {
    const exp = Math.floor(this.clock.now().getTime() / 1000) + ttlSeconds;
    const body = toBase64Url(enc.encode(JSON.stringify({ ...payload, exp })));
    return `${body}.${await hmacSha256B64(this.secret, body)}`;
  }

  async verify<T extends Record<string, unknown>>(token: string): Promise<T | null> {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    if (!safeEqual(sig, await hmacSha256B64(this.secret, body))) return null;
    try {
      const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as T & { exp: number };
      if (typeof payload.exp !== 'number' || payload.exp * 1000 < this.clock.now().getTime()) return null;
      return payload;
    } catch {
      return null;
    }
  }
}

/** seed = HMAC(secret, "fileId:page"). The converter derives the same seed with the same secret. */
export class HmacTileSeeder implements TileSeeder {
  constructor(private readonly secret: string) {}
  async seedFor(fileId: string, pageNo: number): Promise<string> {
    return (await hmacSha256Hex(this.secret, `${fileId}:${pageNo}`)).slice(0, 32);
  }
}

/** Signed device cookie value: "<deviceId>.<signature>". */
export class DeviceCookie {
  static readonly NAME = 'ss_device';
  constructor(private readonly secret: string) {}

  async seal(deviceId: string): Promise<string> {
    return `${deviceId}.${await hmacSha256B64(this.secret, `device:${deviceId}`)}`;
  }

  async open(value: string | undefined): Promise<string | null> {
    if (!value) return null;
    const dot = value.lastIndexOf('.');
    if (dot < 1) return null;
    const id = value.slice(0, dot);
    const sig = value.slice(dot + 1);
    return safeEqual(sig, await hmacSha256B64(this.secret, `device:${id}`)) ? id : null;
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class RandomIds implements IdGenerator {
  next(): string {
    return crypto.randomUUID();
  }
}
