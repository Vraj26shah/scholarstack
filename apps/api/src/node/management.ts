/**
 * Supabase Management API (api.supabase.com) with a personal access token: runs SQL over HTTPS
 * (no database port needed) and configures Auth. Used by `pnpm ops db:apply`.
 */
export class SupabaseManagement {
  constructor(
    private readonly token: string,
    private readonly ref: string,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`https://api.supabase.com/v1/projects/${this.ref}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
  }

  /** Runs one SQL script (may hold many statements). Returns the last statement's rows. */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    return this.call('POST', '/database/query', { query: sql }) as Promise<T[]>;
  }

  authConfig(): Promise<Record<string, unknown>> {
    return this.call('GET', '/config/auth') as Promise<Record<string, unknown>>;
  }

  updateAuthConfig(patch: Record<string, unknown>): Promise<unknown> {
    return this.call('PATCH', '/config/auth', patch);
  }
}
