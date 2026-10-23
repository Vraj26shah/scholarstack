import type { ApiClient } from '../api';
import type { AuthGateway } from './gateway';

const KEY = 'ss-demo-session';

/** Demo sign-in: any college email, no code. Uses the API's demo-only login. */
export class DemoAuthGateway implements AuthGateway {
  readonly supportsGoogle = false;
  private listeners = new Set<(signedIn: boolean) => void>();

  constructor(private readonly api: ApiClient) {}

  private read(): { token: string; email: string } | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  async token() {
    return this.read()?.token ?? null;
  }

  async email() {
    return this.read()?.email ?? null;
  }

  async startEmail(email: string) {
    const { accessToken } = await this.api.demoLogin(email);
    localStorage.setItem(KEY, JSON.stringify({ token: accessToken, email: email.toLowerCase() }));
    for (const l of this.listeners) l(true);
  }

  async startGoogle() {
    throw new Error('Google sign-in is not available in the demo.');
  }

  async completeRedirect() {
    return (await this.token()) !== null;
  }

  async signOut() {
    localStorage.removeItem(KEY);
    for (const l of this.listeners) l(false);
  }

  subscribe(listener: (signedIn: boolean) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
