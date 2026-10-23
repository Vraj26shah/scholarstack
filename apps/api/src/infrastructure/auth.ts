import { isCollegeEmail } from '@ss/contracts';
import { type JWTPayload, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError, fail } from '../application/errors';
import type { Principal } from '../domain/entities';
import type { AuthVerifier } from '../domain/ports';

function toPrincipal(payload: JWTPayload, token: string, domain: string): Principal {
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';
  if (!payload.sub || !sessionId) throw fail.unauthenticated();
  if (!isCollegeEmail(email, domain)) throw fail.notCollege();
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
      return toPrincipal(payload, token, this.domain);
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

  async issue(userId: string, email: string, sessionId: string): Promise<string> {
    if (!isCollegeEmail(email, this.domain)) throw fail.notCollege();
    return new SignJWT({ email: email.toLowerCase(), session_id: sessionId, role: 'authenticated' })
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
      return toPrincipal(payload, token, this.domain);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw fail.unauthenticated();
    }
  }

}
