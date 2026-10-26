/**
 * Just enough ZIP to list and unpack a student's archive inside the Worker, with no library:
 * the central directory gives names and sizes, and DecompressionStream inflates each entry.
 * Guards: a cap on entries and on unpacked size, so a "zip bomb" can't exhaust memory.
 */

export interface ZipEntry {
  path: string;
  size: number;
  compressedSize: number;
  method: number;
  /** Where the entry's local header starts. */
  offset: number;
}

/**
 * entries / unpackedBytes: the whole archive. entryBytes: one file, unpacked in memory at a time
 * (the Worker has ~128 MB), so it stays well under that.
 */
export const ZIP_LIMITS = {
  entries: 300,
  unpackedBytes: 200 * 1024 * 1024,
  entryBytes: 40 * 1024 * 1024,
} as const;

const u16 = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8);
const u32 = (b: Uint8Array, i: number) =>
  (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** Every file in the archive (folders left out). Throws on anything that isn't a sane ZIP. */
export function listZip(bytes: Uint8Array): ZipEntry[] {
  // The end-of-central-directory record sits in the last 64 KB (after an optional comment).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = u16(bytes, eocd + 10);
  const dirStart = u32(bytes, eocd + 16);
  if (count > ZIP_LIMITS.entries) throw new Error(`more than ${ZIP_LIMITS.entries} files inside`);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = dirStart;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error('damaged zip directory');
    const method = u16(bytes, p + 10);
    const compressedSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith('/')) continue;
    total += size;
    if (total > ZIP_LIMITS.unpackedBytes) throw new Error('unpacks to more than 200 MB');
    entries.push({ path, size, compressedSize, method, offset });
  }
  return entries;
}

/** The bytes of one entry. Only "stored" and "deflate" (what every zip tool writes) are supported. */
export async function unzipEntry(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array> {
  if (u32(bytes, e.offset) !== 0x04034b50) throw new Error(`damaged entry ${e.path}`);
  const start = e.offset + 30 + u16(bytes, e.offset + 26) + u16(bytes, e.offset + 28);
  if (e.size > ZIP_LIMITS.entryBytes) throw new Error(`${e.path} is over 40 MB unpacked`);
  const raw = bytes.subarray(start, start + e.compressedSize);
  if (e.method === 0) {
    if (raw.length !== e.size) throw new Error(`${e.path} did not unpack cleanly`);
    return raw.slice();
  }
  if (e.method !== 8) throw new Error(`${e.path} uses an unusual compression`);
  // Unpack chunk by chunk and stop the moment it grows past what the archive declared: a crafted
  // archive can claim a small size and unpack to gigabytes.
  const reader = new Blob([raw.slice()])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const out = new Uint8Array(e.size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > e.size) {
      await reader.cancel().catch(() => {});
      throw new Error(`${e.path} did not unpack cleanly`);
    }
    out.set(value, at);
    at += value.length;
  }
  if (at !== e.size) throw new Error(`${e.path} did not unpack cleanly`);
  return out;
}
