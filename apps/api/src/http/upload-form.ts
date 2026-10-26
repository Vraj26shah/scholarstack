import type { Context } from 'hono';
import { fail } from '../application/errors';
import type { IncomingFile } from '../application/uploads/store-files';
import type { AppEnv } from './helpers';

/**
 * Read a form with a JSON `meta` field and some `files`. The body size is refused from its
 * header before anything is read, so a huge upload never reaches memory.
 */
/** Read a request body, stopping the moment it passes `limit` bytes (whatever length it claims). */
async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return Promise.reject(
        fail.badRequest(`Files together must be under ${Math.round(limit / 1024 / 1024) - 1} MB.`),
      );
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/**
 * A multipart upload: `meta` (JSON) and `files`. The size is enforced while reading, so a request
 * that lies about (or leaves out) its length can't make the server read more than the limit.
 */
export async function readUploadForm(c: Context<AppEnv>, maxBytes: number) {
  const limit = maxBytes + 1024 * 1024;
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > limit)
    throw fail.badRequest(`Files together must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const body = await readLimited(c.req.raw.body, limit);
  let form: FormData;
  try {
    form = await new Request('https://upload.local/', {
      method: 'POST',
      headers: { 'content-type': c.req.header('content-type') ?? '' },
      body: body as BodyInit,
    }).formData();
  } catch {
    throw fail.badRequest('The form was incomplete. Please try again.');
  }
  let meta: unknown;
  try {
    meta = JSON.parse(String(form.get('meta') ?? '{}'));
  } catch {
    throw fail.badRequest('The form was incomplete. Please try again.');
  }
  const list = form.getAll('files').filter((f): f is File => f instanceof File);
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
