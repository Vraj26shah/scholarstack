import { memoryContainer } from '../src/composition/memory';
import type { Clock } from '../src/domain/ports';
import { createApp } from '../src/http/app';

export class TestClock implements Clock {
  t = new Date('2026-10-20T10:00:00Z').getTime();
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t += ms;
  }
}

/** A "browser": remembers its own device cookie and access token. */
export class Browser {
  cookie = '';
  token = '';
  constructor(private readonly app: ReturnType<typeof createApp>) {}

  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.request(`/api${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0]!;
    const type = res.headers.get('content-type') ?? '';
    const json = type.includes('json') ? await res.json() : null;
    return { status: res.status, json: json as any, res };
  }

  async signIn(email: string, label = 'Laptop') {
    const login = await this.call('POST', '/dev/login', { email });
    if (login.status !== 200) return login;
    this.token = login.json.accessToken;
    return this.call('POST', '/session/claim', { label });
  }
}

export function setup() {
  const clock = new TestClock();
  const env = memoryContainer({ seed: true, clock, pageProducer: async () => new Uint8Array([1, 2, 3]) });
  const app = createApp(() => env.container);
  return { clock, env, app };
}

export async function pay(b: Browser, body: Record<string, string>) {
  const start = await b.call('POST', '/orders', body);
  if (start.status !== 201) return start;
  const p = await b.call('POST', '/dev/pay', { gatewayOrderId: start.json.gatewayOrderId });
  return b.call('POST', '/orders/verify', {
    orderId: start.json.orderId,
    gatewayOrderId: start.json.gatewayOrderId,
    gatewayPaymentId: p.json.gatewayPaymentId,
    signature: p.json.signature,
  });
}
