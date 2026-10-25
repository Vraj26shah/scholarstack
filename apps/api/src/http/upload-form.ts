import type { Context } from 'hono';
import { fail } from '../application/errors';
import type { IncomingFile } from '../application/uploads/store-files';
import type { AppEnv } from './helpers';

/**
 * Read a form with a JSON `meta` field and some `files`. The body size is refused from its
 * header before anything is read, so a huge upload never reaches memory.
 */
export async function readUploadForm(c: Context<AppEnv>, maxBytes: number) {
  const length = Number(c.req.header('content-length') ?? 0);
  if (length > maxBytes + 1024 * 1024)
    throw fail.badRequest(`Files together must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    throw fail.badRequest('The form was incomplete. Please try again.');
  }
  let meta: unknown;
  try {
    meta = JSON.parse(String(form.meta ?? '{}'));
  } catch {
    throw fail.badRequest('The form was incomplete. Please try again.');
  }
  const raw = form.files;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
  const files: IncomingFile[] = await Promise.all(
    list.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  return { meta, files };
}

/** A stored upload as a download: always an attachment, never rendered by the browser. */
export function attachment(f: { body: unknown; name: string; size: number }) {
  return new Response(f.body as BodyInit, {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${f.name.replace(/["\r\n]/g, '')}"`,
      'content-length': String(f.size),
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}
