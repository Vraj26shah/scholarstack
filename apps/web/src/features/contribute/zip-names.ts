export interface ZipFileEntry {
  path: string;
  size: number;
}

/** Read file names and expanded sizes from a ZIP directory without unpacking it. */
export function zipEntries(bytes: Uint8Array): ZipFileEntry[] | null {
  const u16 = (i: number) => bytes[i]! | (bytes[i + 1]! << 8);
  const u32 = (i: number) =>
    (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--)
    if (u32(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const count = u16(eocd + 10);
  // Never show a partial tree as though it were the complete archive.
  if (count > 5000) return null;
  let p = u32(eocd + 16);
  const decoder = new TextDecoder();
  const files: ZipFileEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(p) !== 0x02014b50) return null;
    const nameLen = u16(p + 28);
    const path = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    const size = u32(p + 24);
    if (!path.endsWith('/')) files.push({ path, size });
    p += 46 + nameLen + u16(p + 30) + u16(p + 32);
  }
  return files;
}
