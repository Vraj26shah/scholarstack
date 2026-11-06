import { deflateRawSync } from 'node:zlib';

const enc = new TextEncoder();

/** A real (deflated) zip, written the way every zip tool does. */
export function zip(files: [string, Uint8Array][]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const n = enc.encode(name);
    const body = deflateRawSync(data);
    const local = new Uint8Array(30 + n.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, 8, true);
    v.setUint32(18, body.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, n.length, true);
    local.set(n, 30);
    const dir = new Uint8Array(46 + n.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(10, 8, true);
    d.setUint32(20, body.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, n.length, true);
    d.setUint32(42, offset, true);
    dir.set(n, 46);
    chunks.push(local, body);
    central.push(dir);
    offset += local.length + body.length;
  }
  const dirSize = central.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, offset, true);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((t, c) => t + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Kept for older tests: students may send one ZIP or one document, so files go as they are. */
export function zipped(files: [string, Uint8Array][]): [string, Uint8Array][] {
  return files;
}
