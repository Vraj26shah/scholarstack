import { isCollegeEmail, normaliseEmail } from '@ss/contracts';
import { type JWTPayload, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, fail } from '../application/errors';
import type { Principal } from '../domain/entities';
import type { AuthVerifier } from '../domain/ports';

/**
 * How the person proved they own the inbox. Only these sign-ins count: a Google login, a
 * one-time code or a magic link. A password sign-up proves nothing about the inbox (anyone can
 * type someone else's address), so it is refused outright, as are anonymous sessions.
 */
const PROVEN = new Set(['otp', 'oauth', 'magiclink', 'email/signup', 'invite', 'sso/saml', 'email_change']);
const REFUSED = new Set(['password', 'anonymous']);

function signInMethods(payload: JWTPayload): string[] {
  const amr = (payload as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return [];
  return amr
    .map((m) => (typeof m === 'string' ? m : typeof m?.method === 'string' ? m.method : ''))
    .filter(Boolean);
}

/** Says whether an address outside the college domain is an admin (read from the database). */
export type AdminCheck = (email: string) => Promise<boolean>;

async function toPrincipal(
  payload: JWTPayload,
  token: string,
  domain: string,
  isAdmin: AdminCheck = async () => false,
): Promise<Principal> {
  const email = typeof payload.email === 'string' ? normaliseEmail(payload.email) : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!payload.sub || !sessionId || !email) throw fail.unauthenticated();
  if ((payload as { is_anonymous?: unknown }).is_anonymous === true) throw fail.unauthenticated();
  const methods = signInMethods(payload);
  if (methods.some((m) => REFUSED.has(m)) || !methods.some((m) => PROVEN.has(m)))
    throw fail.unauthenticated();
  // College addresses only, except the exact addresses on the admin list.
  if (!isCollegeEmail(email, domain) && !(await isAdmin(email))) throw fail.notCollege();
  return { userId: payload.sub, email, sessionId, accessToken: token };
}

/**
 * Verifies Supabase access tokens. New projects sign with asymmetric keys published at the
 * JWKS endpoint; older projects use a shared secret (SUPABASE_LEGACY_JWT_SECRET).
 */
export class SupabaseJwtVerifier implements AuthVerifier {
  private readonly jwks;
  private readonly legacyKey: Uint8Array | null;

  constructor(
    private readonly supabaseUrl: string,
    legacySecret: string,
    private readonly domain: string,
    private readonly isAdmin: AdminCheck = async () => false,
  ) {
    this.jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    this.legacyKey = legacySecret ? new TextEncoder().encode(legacySecret) : null;
  }

  async verify(token: string): Promise<Principal> {
    const options = { issuer: `${this.supabaseUrl}/auth/v1`, audience: 'authenticated' };
    try {
      const { payload } = this.legacyKey
        ? await jwtVerify(token, this.legacyKey, options)
        : await jwtVerify(token, this.jwks, options);
      return await toPrincipal(payload, token, this.domain, this.isAdmin);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw fail.unauthenticated();
    }
  }
}

/**
 * Demo / test auth: issues and verifies HS256 tokens shaped like Supabase's.
 * Only wired in when APP_MODE=demo, never in production.
 */
export class DemoAuth implements AuthVerifier {
  private readonly key: Uint8Array;
  constructor(
    secret: string,
    private readonly domain: string,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  private isAdmin: AdminCheck = async () => false;

  /** Same rule as production: admins on the list may use any address. */
  allowAdmins(check: AdminCheck) {
    this.isAdmin = check;
  }

  async issue(userId: string, email: string, sessionId: string): Promise<string> {
    if (!isCollegeEmail(email, this.domain) && !(await this.isAdmin(email))) throw fail.notCollege();
    return new SignJWT({
      email: email.toLowerCase(),
      session_id: sessionId,
      role: 'authenticated',
      amr: [{ method: 'otp', timestamp: Math.floor(Date.now() / 1000) }],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('scholars-stack-demo')
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime('12h')
      .sign(this.key);
  }

  async verify(token: string): Promise<Principal> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: 'scholars-stack-demo',
        audience: 'authenticated',
      });
      return await toPrincipal(payload, token, this.domain, this.isAdmin);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw fail.unauthenticated();
    }
  }
}
