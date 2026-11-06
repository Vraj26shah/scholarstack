import type { ClientProblemInput, ProblemDto } from '@ss/contracts';
import type { ProblemLog, ProblemReport } from '../domain/ports';
import { sha256Hex } from '../infrastructure/crypto';

/** Strip anything personal or secret from a message before it is stored. */
function scrub(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/(token|signature|secret|key|password)=([^&\s]+)/gi, '$1=<hidden>')
    .replace(/\b(rzp|pay|order)_[A-Za-z0-9]{8,}\b/g, '$1_<id>');
}

/** "/c/dbms-2023/…?x=1" and "/read/0b1e…" group together regardless of ids and query strings. */
function pathPattern(path: string): string {
  return path
    .split(/[?#]/)[0]!
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+(?=\/|$)/g, '/:n')
    .slice(0, 200);
}

export function deviceLabel(userAgent: string): string {
  const ua = userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Instagram/.test(ua)
          ? 'Instagram in-app'
          : /FBAN|FBAV/.test(ua)
            ? 'Facebook in-app'
            : /WhatsApp/.test(ua)
              ? 'WhatsApp in-app'
              : /Firefox\//.test(ua)
                ? 'Firefox'
                : /Chrome\//.test(ua)
                  ? 'Chrome'
                  : /Safari\//.test(ua)
                    ? 'Safari'
                    : 'Browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}

/**
 * The admin's view of what is going wrong for students: browser errors they would never report
 * and server errors, grouped so the same problem shows once with a count.
 */
export class ProblemService {
  constructor(private readonly log: ProblemLog) {}

  async fromBrowser(input: ClientProblemInput, userAgent: string): Promise<void> {
    const message = scrub(input.message).slice(0, 500);
    const path = pathPattern(input.path);
    await this.log.record({
      fingerprint: (await sha256Hex(`browser|${input.kind}|${message.replace(/\d+/g, 'N')}|${path}`)).slice(
        0,
        40,
      ),
      source: 'browser',
      kind: input.kind,
      message,
      path,
      detail: scrub(input.detail).slice(0, 2000),
      userAgent: userAgent.slice(0, 300),
    });
  }

  async fromServer(error: Error, method: string, path: string): Promise<void> {
    const message = scrub(error.message || 'Server error').slice(0, 500);
    const where = `${method} ${pathPattern(path)}`;
    await this.log.record({
      fingerprint: (await sha256Hex(`server|${message.replace(/\d+/g, 'N')}|${where}`)).slice(0, 40),
      source: 'server',
      kind: 'server',
      message,
      path: where,
      detail: scrub(error.stack ?? '').slice(0, 2000),
      userAgent: '',
    });
  }

  async list(limit = 200): Promise<ProblemDto[]> {
    return (await this.log.list(limit)).map((p: ProblemReport) => ({
      fingerprint: p.fingerprint,
      source: p.source,
      kind: p.kind,
      message: p.message,
      path: p.path,
      detail: p.detail,
      device: p.userAgent ? deviceLabel(p.userAgent) : '',
      count: p.count,
      firstAt: p.firstAt.toISOString(),
      lastAt: p.lastAt.toISOString(),
    }));
  }

  clear(fingerprints?: string[]) {
    return this.log.clear(fingerprints);
  }
}
