/**
 * Sentry tunnel. The site sends its error reports, performance data and replays to
 * /api/monitoring instead of *.ingest.sentry.io, so ad blockers (which block Sentry's domains)
 * don't silently drop them. We pass each envelope on, unchanged, to Sentry's ingest for the
 * project it names — and only to a real Sentry ingest host, and only our own project when the
 * Worker knows the DSN, so this can't be used as an open relay.
 *
 * An envelope is newline-separated: the first line is a JSON header that carries the DSN.
 */

/** Sentry accepts envelopes up to 20 MB; the browser's are far smaller. Replays stay well under this. */
export const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;

const INGEST_HOST = /^o\d+\.ingest(\.(us|de))?\.sentry\.io$/;

export interface TunnelTarget {
  url: string;
  host: string;
  projectId: string;
}

function parseDsn(dsn: string): { host: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
    if (u.protocol !== 'https:' || !/^\d+$/.test(projectId)) return null;
    return { host: u.hostname, projectId };
  } catch {
    return null;
  }
}

/**
 * The envelope's header line, decoded from the raw bytes. Only this line is read: the items after
 * it can be binary (compressed replay recordings) and are forwarded exactly as they came.
 */
export function envelopeHeaderLine(bytes: Uint8Array): string {
  const nl = bytes.indexOf(0x0a);
  return new TextDecoder().decode(nl === -1 ? bytes : bytes.subarray(0, nl));
}

/**
 * Where an envelope should go, or why it's refused. `allowedDsn` (the Worker's SENTRY_DSN) pins
 * the host and project; without it, any real Sentry ingest host is accepted.
 */
export function tunnelTarget(
  firstLine: string,
  allowedDsn: string,
): { ok: true; target: TunnelTarget } | { ok: false; reason: string } {
  let header: { dsn?: unknown };
  try {
    header = JSON.parse(firstLine);
  } catch {
    return { ok: false, reason: 'not an envelope' };
  }
  if (typeof header.dsn !== 'string') return { ok: false, reason: 'no dsn' };
  const dsn = parseDsn(header.dsn);
  if (!dsn || !INGEST_HOST.test(dsn.host)) return { ok: false, reason: 'not a Sentry ingest dsn' };
  const allowed = allowedDsn ? parseDsn(allowedDsn) : null;
  if (allowed && (allowed.host !== dsn.host || allowed.projectId !== dsn.projectId))
    return { ok: false, reason: 'another project' };
  return {
    ok: true,
    target: {
      url: `https://${dsn.host}/api/${dsn.projectId}/envelope/`,
      host: dsn.host,
      projectId: dsn.projectId,
    },
  };
}
