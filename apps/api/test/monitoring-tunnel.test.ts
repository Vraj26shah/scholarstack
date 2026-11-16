import { afterEach, describe, expect, it, vi } from 'vitest';
import { envelopeHeaderLine, tunnelTarget } from '../src/http/monitoring-tunnel';
import { setup } from './harness';

const DSN = 'https://5e8855f14f30edb9b0a5f0fd68c9c63b@o4512431409987584.ingest.us.sentry.io/4512431443476480';
const header = (dsn: string) => JSON.stringify({ event_id: 'abc', sent_at: '2026-11-17T00:00:00Z', dsn });

/** An envelope like a replay: JSON header, item header, then binary (compressed) bytes. */
function envelope(dsn = DSN): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(`${header(dsn)}\n{"type":"replay_recording","length":6}\n`);
  const binary = new Uint8Array([0x1f, 0x8b, 0x00, 0xff, 0x0a, 0x80]); // includes a newline byte
  const out = new Uint8Array(new ArrayBuffer(text.length + binary.length));
  out.set(text);
  out.set(binary, text.length);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe('monitoring tunnel rules', () => {
  it('sends an envelope to its own project on a real Sentry ingest host', () => {
    const r = tunnelTarget(envelopeHeaderLine(envelope()), '');
    expect(r).toEqual({
      ok: true,
      target: {
        url: 'https://o4512431409987584.ingest.us.sentry.io/api/4512431443476480/envelope/',
        host: 'o4512431409987584.ingest.us.sentry.io',
        projectId: '4512431443476480',
      },
    });
  });

  it('refuses anything that is not a Sentry ingest DSN, and other projects once the DSN is known', () => {
    expect(tunnelTarget('not json', '').ok).toBe(false);
    expect(tunnelTarget(JSON.stringify({ event_id: 'x' }), '').ok).toBe(false);
    expect(tunnelTarget(header('https://key@evil.example.com/1'), '').ok).toBe(false);
    expect(tunnelTarget(header('http://key@o1.ingest.sentry.io/1'), '').ok).toBe(false);
    expect(tunnelTarget(header('https://key@o1.ingest.sentry.io.evil.com/1'), '').ok).toBe(false);
    const other = header('https://k@o999.ingest.us.sentry.io/123');
    expect(tunnelTarget(other, '').ok).toBe(true);
    expect(tunnelTarget(other, DSN)).toEqual({ ok: false, reason: 'another project' });
    expect(tunnelTarget(header(DSN), DSN).ok).toBe(true);
  });
});

describe('POST /api/monitoring', () => {
  it('forwards the exact bytes (binary replay data included) and passes Sentry’s answer back', async () => {
    const { app } = setup();
    const sent: { url: string; body: Uint8Array; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: new Uint8Array(init.body as Uint8Array),
        headers: new Headers(init.headers),
      });
      return new Response('{}', { status: 200, headers: { 'x-sentry-rate-limits': '60:transaction' } });
    });
    const body = envelope();
    const res = await app.request('/api/monitoring', {
      method: 'POST',
      body,
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-sentry-rate-limits')).toBe('60:transaction');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://o4512431409987584.ingest.us.sentry.io/api/4512431443476480/envelope/');
    expect([...sent[0]!.body]).toEqual([...body]);
    expect(sent[0]!.headers.get('x-forwarded-for')).toBe('203.0.113.7');
  });

  it('refuses junk without calling Sentry, caps the size, and rate-limits each network', async () => {
    const { app } = setup();
    const calls = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', calls);
    const post = (body: BodyInit, ip = '198.51.100.1') =>
      app.request('/api/monitoring', { method: 'POST', body, headers: { 'cf-connecting-ip': ip } });

    expect((await post(envelope('https://k@evil.example.com/1'), '198.51.100.9')).status).toBe(400);
    expect((await post(new Uint8Array(3 * 1024 * 1024), '198.51.100.8')).status).toBe(413);
    expect(calls).not.toHaveBeenCalled();

    let last = 0;
    for (let i = 0; i < 41; i++) last = (await post(envelope())).status;
    expect(last).toBe(429);
  });

  it('reports a Sentry outage as 502 instead of throwing', async () => {
    const { app } = setup();
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('/api/monitoring', { method: 'POST', body: envelope() });
    expect(res.status).toBe(502);
  });
});
