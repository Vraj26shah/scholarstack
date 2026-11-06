import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { fail } from '../application/errors';
import type { Principal } from '../domain/entities';
import { sha256Hex } from '../infrastructure/crypto';
import type { Container } from './container';

export interface AppEnv {
  Variables: {
    container: Container;
    requestId: string;
    principal: Principal;
    deviceId: string;
  };
}

type Ctx = Context<AppEnv>;

export function bearer(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Requires a valid college access token. Does not check the live session. */
export async function authenticate(c: Ctx): Promise<Principal> {
  const token = bearer(c.req.header('authorization'));
  if (!token) throw fail.unauthenticated();
  const principal = await c.get('container').auth.verify(token);
  c.set('principal', principal);
  return principal;
}

/** Refuses a burst of the same action from one student or one address. */
export async function throttle(c: Ctx, action: string, who: string): Promise<void> {
  if (!(await c.get('container').limiter.allow(`${action}:${who}`))) throw fail.rateLimited();
}

export async function cookieDeviceId(c: Ctx): Promise<string | null> {
  return c.get('container').deviceCookie.open(getCookie(c, 'ss_device'));
}

/** Requires a valid token AND that this is the account's live session on this device. */
export async function requireLive(c: Ctx): Promise<{ principal: Principal; deviceId: string }> {
  const principal = await authenticate(c);
  const deviceId = await c.get('container').account.assertLive(principal, await cookieDeviceId(c));
  c.set('deviceId', deviceId);
  return { principal, deviceId };
}

export async function setDeviceCookie(c: Ctx, deviceId: string) {
  const container = c.get('container');
  setCookie(c, 'ss_device', await container.deviceCookie.seal(deviceId), {
    httpOnly: true,
    secure: container.secureCookies,
    sameSite: 'Strict',
    path: '/api',
    maxAge: 400 * 24 * 60 * 60,
  });
}

/** A stable, one-way key for the caller's network (for blocks that must last across midnight). */
export async function networkKey(c: Ctx) {
  const ip =
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return (await sha256Hex(`net|${ip}`)).slice(0, 32);
}

export async function requestMeta(c: Ctx) {
  const ip =
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return {
    ipHash: (await sha256Hex(`${ip}|${new Date().toISOString().slice(0, 10)}`)).slice(0, 24),
    userAgent: (c.req.header('user-agent') ?? '').slice(0, 200),
  };
}
