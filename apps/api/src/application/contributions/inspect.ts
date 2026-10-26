import type { FileCheckDto } from '@ss/contracts';
import { ZIP_LIMITS, listZip } from './zip';

/** What the page maker can turn into pages. */
export const PAGE_FORMATS = [
  'pdf',
  'doc',
  'docx',
  'odt',
  'ppt',
  'pptx',
  'pps',
  'ppsx',
  'odp',
  'jpg',
  'jpeg',
  'png',
];

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|~\$|\._)/i;

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** Is this path inside an archive worth keeping, and if not, why. */
export function entryVerdict(path: string): { ok: boolean; reason?: string; junk?: boolean } {
  if (JUNK.test(path)) return { ok: false, reason: 'system file', junk: true };
  const e = ext(path);
  if (e === 'zip' || e === 'rar' || e === '7z') return { ok: false, reason: 'an archive inside the archive' };
  if (!PAGE_FORMATS.includes(e))
    return { ok: false, reason: e ? `.${e} files can't become pages` : 'no file type' };
  return { ok: true };
}

/**
 * Scan a big file a megabyte at a time (never one huge string). Each chunk repeats the last 16
 * bytes of the one before, so a marker split across the boundary is still seen; `overlap` says
 * how many leading characters were already scanned.
 */
function scan(bytes: Uint8Array, each: (chunk: string, overlap: number) => void) {
  const decoder = new TextDecoder('latin1');
  const size = 1 << 20;
  for (let i = 0; i < bytes.length; i += size) {
    const from = Math.max(0, i - 16);
    each(decoder.decode(bytes.subarray(from, i + size)), i - from);
  }
}

/** Roughly how many pages a PDF has (counts page objects; good enough for a review label). */
export function pdfFacts(bytes: Uint8Array): { pages: number; locked: boolean } {
  let pages = 0;
  let locked = false;
  scan(bytes, (chunk, overlap) => {
    // A match that ends inside the overlap was counted with the previous chunk.
    for (const m of chunk.matchAll(/\/Type\s*\/Page(?![s\w])/g))
      if ((m.index ?? 0) + m[0].length > overlap) pages++;
    if (/\/Encrypt\b/.test(chunk)) locked = true;
  });
  return { pages, locked };
}

/**
 * The automatic check run on every uploaded file: what it is, roughly how big, and whether the
 * page maker can use it. Never throws; a file it can't read gets ok: false with a reason.
 */
export function inspectFile(name: string, bytes: Uint8Array): FileCheckDto {
  const e = ext(name);
  try {
    if (e === 'pdf') {
      const { pages, locked } = pdfFacts(bytes);
      if (locked)
        return {
          format: 'pdf',
          label: 'PDF · password-protected',
          ok: false,
          problem: 'This PDF is locked. Ask the student for a copy without a password.',
        };
      return {
        format: 'pdf',
        label: pages ? `PDF · about ${pages} page${pages === 1 ? '' : 's'}` : 'PDF',
        ok: true,
      };
    }
    if (e === 'docx' || e === 'pptx') {
      const inside = listZip(bytes).map((x) => x.path);
      const word = inside.some((p) => p.startsWith('word/'));
      const slides = inside.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).length;
      if (e === 'docx' && !word)
        return { format: 'word', label: 'Word', ok: false, problem: "This isn't a real Word document." };
      if (e === 'pptx' && !slides)
        return {
          format: 'powerpoint',
          label: 'PowerPoint',
          ok: false,
          problem: "This isn't a real PowerPoint file.",
        };
      return e === 'docx'
        ? { format: 'word', label: 'Word document', ok: true }
        : { format: 'powerpoint', label: `PowerPoint · ${slides} slide${slides === 1 ? '' : 's'}`, ok: true };
    }
    if (e === 'doc') return { format: 'word', label: 'Word (older format)', ok: true };
    if (e === 'ppt') return { format: 'powerpoint', label: 'PowerPoint (older format)', ok: true };
    if (e === 'jpg' || e === 'jpeg' || e === 'png')
      return { format: 'image', label: `${e === 'png' ? 'PNG' : 'JPG'} image · 1 page`, ok: true };
    if (e === 'zip') {
      const entries = listZip(bytes)
        .map((x) => ({
          path: x.path,
          size: x.size,
          ...(x.size > ZIP_LIMITS.entryBytes
            ? { ok: false, reason: 'over 40 MB; ask for it on its own' }
            : entryVerdict(x.path)),
        }))
        .filter((x) => !x.junk)
        .map(({ junk: _junk, ...x }) => x);
      const usable = entries.filter((x) => x.ok).length;
      return {
        format: 'zip',
        label: `ZIP · ${entries.length} file${entries.length === 1 ? '' : 's'}, ${usable} usable`,
        ok: usable > 0,
        ...(usable ? {} : { problem: 'Nothing inside can become pages (PDF, Word, PowerPoint or images).' }),
        entries,
      };
    }
    return {
      format: 'other',
      label: e ? `.${e} file` : 'Unknown file',
      ok: false,
      problem: "This type can't become pages.",
    };
  } catch (err) {
    return {
      format: e === 'zip' ? 'zip' : 'other',
      label: e ? `.${e} file` : 'Unknown file',
      ok: false,
      problem: `The file looks damaged (${(err as Error).message}). Ask the student to upload it again.`,
    };
  }
}
