import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { SupabaseJwtVerifier } from '../src/infrastructure/auth';

/**
 * Supabase-shaped tokens (legacy HS256 mode so the test can sign them). Each case is a trick a
 * student might try to get in as someone else, or as the admin.
 */
const SECRET = 'test-legacy-jwt-secret-that-is-long-enough-123';
const URL_ = 'https://example.supabase.co';
const verifier = new SupabaseJwtVerifier(URL_, SECRET, 'vitbhopal.ac.in', async (e) =>
  ['vitbsmashers@gmail.com'].includes(e),
);

async function token(email: string, extra: Record<string, unknown> = {}) {
  return new SignJWT({
    email,
    session_id: 'sess-1',
    role: 'authenticated',
    amr: [{ method: 'otp', timestamp: 1 }],
    ...extra,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setIssuer(`${URL_}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

const code = async (p: Promise<unknown>) => p.then(() => 'OK').catch((e) => (e as { code?: string }).code);

describe('who may sign in', () => {
  it('a student who proved their college inbox (code or Google) gets in', async () => {
    expect(await code(verifier.verify(await token('rahul.23bce1@vitbhopal.ac.in')))).toBe('OK');
    expect(
      await code(
        verifier.verify(await token('rahul.23bce1@vitbhopal.ac.in', { amr: [{ method: 'oauth' }] })),
      ),
    ).toBe('OK');
  });

  it('the admin Gmail gets in only after proving the inbox', async () => {
    expect(await code(verifier.verify(await token('vitbsmashers@gmail.com')))).toBe('OK');
    expect(
      await code(verifier.verify(await token('VitbSmashers@Gmail.com', { amr: [{ method: 'oauth' }] }))),
    ).toBe('OK');
  });

  it('typing the admin address with a password (no inbox proof) is refused', async () => {
    const t = await token('vitbsmashers@gmail.com', { amr: [{ method: 'password', timestamp: 1 }] });
    expect(await code(verifier.verify(t))).toBe('UNAUTHENTICATED');
  });

  it('anonymous sessions and tokens with no sign-in method are refused', async () => {
    expect(await code(verifier.verify(await token('vitbsmashers@gmail.com', { is_anonymous: true })))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await code(verifier.verify(await token('vitbsmashers@gmail.com', { amr: [] })))).toBe(
      'UNAUTHENTICATED',
    );
    expect(await code(verifier.verify(await token('vitbsmashers@gmail.com', { amr: undefined })))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it.each([
    'someone@gmail.com',
    'vit.bsmashers@gmail.com',
    'vitbsmashers+x@gmail.com',
    'vitbsmashers@gmail.com.evil.in',
    'vitbsmashers@gmаil.com',
    'rahul+2@vitbhopal.ac.in',
    'rahul@vitbhopal.ac.in.evil.com',
  ])('%s is not let in', async (email) => {
    expect(await code(verifier.verify(await token(email)))).toBe('NOT_COLLEGE_EMAIL');
  });

  it('a forged token (wrong key) is refused', async () => {
    const forged = await new SignJWT({
      email: 'vitbsmashers@gmail.com',
      session_id: 's',
      amr: [{ method: 'otp' }],
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('x')
      .setIssuer(`${URL_}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('not-the-real-secret-not-the-real-secret'));
    expect(await code(verifier.verify(forged))).toBe('UNAUTHENTICATED');
  });
});
