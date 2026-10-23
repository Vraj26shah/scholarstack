/**
 * Turning messy Google-Drive-style folder and file names into tidy courses and units.
 * Pure functions: no I/O, easy to test against real folder names.
 */
import type { FileFormat, UnitKind } from '@ss/contracts';

export const FORMAT_BY_EXT: Record<string, FileFormat> = {
  pdf: 'pdf',
  ppt: 'pptx',
  pptx: 'pptx',
  pps: 'pptx',
  ppsx: 'pptx',
  odp: 'pptx',
  doc: 'docx',
  docx: 'docx',
  odt: 'docx',
  txt: 'docx',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
};

const JUNK = /^(\.|~\$)|^(thumbs\.db|desktop\.ini|\.ds_store|icon\r?)$/i;

export function isJunkFile(name: string): boolean {
  return JUNK.test(name);
}

export function formatOf(name: string): FileFormat | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return name.includes('.') ? (FORMAT_BY_EXT[ext] ?? null) : null;
}

/** "dbms_notes" / "DBMS-NOTES" / "01 - Operating systems" → readable title. */
export function cleanTitle(raw: string): string {
  let t = raw
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/^\s*\d{1,2}\s*[.)\-–:]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^[a-z0-9 -]+$/.test(t) && t.includes('-') && !t.includes(' ')) t = t.replace(/-/g, ' ');
  if (t === t.toLowerCase()) {
    const small = new Set(['and', 'of', 'the', 'in', 'to', 'for', 'a', 'an', 'on']);
    t = t
      .split(' ')
      .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ');
  }
  return t || raw;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'course'
  );
}

const UNIT_WORDS: Record<string, string> = {
  unit: 'unit',
  u: 'unit',
  module: 'module',
  mod: 'module',
  m: 'module',
  chapter: 'chapter',
  ch: 'chapter',
  part: 'part',
  week: 'week',
  lecture: 'lecture',
  lec: 'lecture',
};

/**
 * A unit sub-folder name → stable key + title.
 *   "unit-3-normalisation" → unit-3 / Normalisation
 *   "Module 2 - SQL"       → module-2 / SQL
 *   "02. Transactions"     → unit-2 / Transactions
 *   "PYQs"                 → pyqs / PYQs
 */
export function parseUnit(folder: string): { key: string; title: string } {
  const name = folder.replace(/_/g, ' ').trim();
  const word =
    /^(unit|module|mod|chapter|ch|part|week|lecture|lec|u|m)[\s.\-]*0*(\d{1,2})(?!\d)[\s.:\-–]*(.*)$/i.exec(
      name,
    );
  if (word) {
    const kind = UNIT_WORDS[word[1]!.toLowerCase()]!;
    const n = Number(word[2]);
    const rest = word[3]?.trim();
    return {
      key: `${kind}-${n}`,
      title: rest ? cleanTitle(rest) : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${n}`,
    };
  }
  const numbered = /^0*(\d{1,2})\s*[.)\-–:]\s*(.+)$/.exec(name);
  if (numbered) return { key: `unit-${Number(numbered[1])}`, title: cleanTitle(numbered[2]!) };
  return { key: slugify(name), title: cleanTitle(name) };
}

/** "23 Batch", "Batch 2023", "2023-batch" → 2023. */
export function guessBatchYear(segments: string[]): number | null {
  for (const seg of segments) {
    const m = /(?:^|\D)(\d{4}|\d{2})\s*[-_ ]?\s*batch|batch\s*[-_ ]?\s*(\d{4}|\d{2})(?!\d)/i.exec(seg);
    const raw = m?.[1] ?? m?.[2];
    if (raw) {
      const n = Number(raw);
      return raw.length === 2 ? 2000 + n : n;
    }
  }
  return null;
}

/** "Sem 5", "semester-3", "SEM_7" → 5, 3, 7. */
export function guessSemester(segments: string[]): number | null {
  for (const seg of [...segments].reverse()) {
    const m = /sem(?:ester)?\s*[-_ ]?\s*(\d{1,2})(?!\d)/i.exec(seg);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 10) return n;
    }
  }
  return null;
}

/** Natural order: "Unit 2" before "Unit 10". */
export const naturalCompare = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ── Course folders ("Database Management Systems (CSE3001)") ──

/** "Database Management Systems (CSE3001)" → { title: "Database Management Systems", code: "CSE3001" }. */
export function parseCourseFolder(folder: string): { title: string; code: string | null } {
  const m = /^(.*?)\s*[([]\s*([A-Za-z]{3}\s?\d{4}[A-Za-z]?)\s*[)\]]\s*$/.exec(folder.trim());
  if (m) return { title: cleanTitle(m[1]!), code: m[2]!.replace(/\s/g, '').toUpperCase() };
  const code = /\b([A-Za-z]{3}\d{4})\b/.exec(folder)?.[1]?.toUpperCase() ?? null;
  return { title: cleanTitle(folder), code };
}

// ── Unit kinds ──

const KIND_RULES: [UnitKind, RegExp][] = [
  ['reference', /\bref(erence)?s?\b|\btext\s*books?\b|\bbooks?\b/i],
  ['pyq', /\bpyqs?\b|previous|question\s*papers?|\bpapers?\b|\bexams?\b|\b(mte|tee|cat|fat)\b/i],
  ['syllabus', /syllabus|course\s*(plan|outline)|\bltp\b/i],
  ['lab', /\blabs?\b|practical|manual/i],
  ['revision', /revision|cheat\s*sheet|summary|quick\s*notes|formula/i],
];

/** What a unit folder holds, from its name. Numbered folders (Module 2, Unit 3) are modules. */
export function unitKindOf(folder: string): UnitKind {
  if (/^(unit|module|mod|chapter|ch|part|week|lecture|lec|u|m)[\s.\-_]*\d/i.test(folder.trim()))
    return 'module';
  if (/^\d{1,2}\s*[.)\-–:]\s*\S/.test(folder.trim())) return 'module';
  for (const [kind, re] of KIND_RULES) if (re.test(folder)) return kind;
  return 'other';
}

const KIND_RANK: Record<UnitKind, number> = {
  module: 0,
  revision: 1,
  pyq: 2,
  lab: 3,
  syllabus: 4,
  notes: 5,
  other: 6,
  reference: 7,
};

/** Order of a unit in its course: kind first, then the number in its name ("Module 10" after "Module 2"). */
export function unitSortOf(kind: UnitKind, key: string): number {
  const n = Number(/-(\d+)$/.exec(key)?.[1] ?? 0);
  return KIND_RANK[kind] * 1000 + Math.min(n, 999);
}

/** Units we never sell by default: publishers' books are not our notes. */
export const hiddenByDefault = (kind: UnitKind): boolean => kind === 'reference';

/**
 * A file that looks like a published textbook (not student notes). Hidden on import so it is
 * never sold by accident; the admin can show it if it really is their own material.
 */
export function looksLikeTextbook(fileName: string): boolean {
  return /z-?lib|libgen|\bedition\b|\b\d+(st|nd|rd|th)\s*ed\b|complete[\s_-]*reference|\b(pearson|mcgraw|wiley|oxford|cengage|elsevier|springer)\b|textbook|\breference[\s_-]*books?\b|grewal|kreyszig|ereszig|thomas[\s_-]*calculus|balagurusamy|(advanced|higher)[\s_-]*engineering[\s_-]*mathematics/i.test(
    fileName,
  );
}

/** "Higher Engineering Mathematics By Dr. B.S. Grewal by B.S Grewal (z-lib.org).pdf" → "Higher Engineering Mathematics By Dr. B.S. Grewal". */
export function bookTitle(fileName: string): string {
  let t = fileName
    .split('/')
    .pop()!
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/\((z-?lib(\.org)?|libgen[^)]*|ebook[^)]*)\)/gi, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=[a-z])-(?=[a-z])/gi, ' ')
    .replace(/\s*\d+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "X by A by A" → "X by A"
  t = t.replace(/(\bby\b.+?)\s+by\b.*$/i, '$1').trim();
  if (t === t.toUpperCase() || t === t.toLowerCase()) t = cleanTitle(t.toLowerCase());
  return t || fileName;
}
