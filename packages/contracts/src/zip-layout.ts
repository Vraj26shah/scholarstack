/**
 * The shape of a whole-subject ZIP, worked out from the file names inside it. The same rules run
 * in the browser (so a student sees at once whether their ZIP qualifies for the 30% share) and in
 * the Worker (so the admin sees it next to the upload).
 *
 *   DBMS (CSE3001).zip
 *   ├─ Syllabus/            the official syllabus (PDF or a photo)
 *   ├─ Unit 1 - Introduction/
 *   ├─ Unit 2 - ER model/   one folder per unit or module, in order
 *   └─ PYQs/                past papers (optional)
 */

export interface ZipLayout {
  /** The folder everything sits in, if there is one: usually the subject's name. */
  subject: string | null;
  /** Files in the Syllabus folder. */
  syllabus: number;
  /** Unit / module folders in order, with how many files each holds. */
  units: { name: string; files: number }[];
  /** Files in the past-papers folder. */
  pyqs: number;
  /** Other folders (kept, but not part of the layout). */
  other: string[];
  /** Files lying loose at the top instead of in a folder. */
  loose: number;
  /** Syllabus plus at least one unit: a whole subject that can go on sale as a course. */
  wholeSubject: boolean;
  /** What to fix to make it a whole subject, in plain words. */
  missing: string[];
}

const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$|~\$|\._)/i;
const SYLLABUS = /syllabus|curriculum/i;
const PYQS = /pyq|previous|question\s*papers?|past\s*papers?|old\s*papers?/i;
const UNIT = /^(unit|module|mod|chapter|ch|part)[\s._-]*(\d+|[ivx]+)\b/i;

const order = (name: string) => {
  const m = name.match(/(\d+)/);
  return m ? Number(m[1]) : 999;
};

export function zipLayout(paths: string[]): ZipLayout {
  const files = paths.map((p) => p.replace(/\\/g, '/')).filter((p) => !p.endsWith('/') && !JUNK.test(p));
  // One wrapping folder (the subject) is normal; look inside it.
  const tops = new Set(files.map((p) => (p.includes('/') ? p.split('/')[0]! : '')));
  const only = tops.size === 1 && !tops.has('') ? [...tops][0]! : null;
  // One top folder that isn't itself a syllabus, unit or past-papers folder is the subject.
  const wrapped = !!only && !SYLLABUS.test(only) && !PYQS.test(only) && !UNIT.test(only);
  const subject = wrapped ? [...tops][0]! : null;
  const inner = wrapped ? files.map((p) => p.slice(subject!.length + 1)) : files;

  let syllabus = 0;
  let pyqs = 0;
  let loose = 0;
  const units = new Map<string, number>();
  const other = new Set<string>();
  for (const p of inner) {
    const parts = p.split('/');
    if (parts.length === 1) {
      // A single syllabus file at the top counts as the syllabus.
      if (SYLLABUS.test(parts[0]!)) syllabus++;
      else loose++;
      continue;
    }
    const folder = parts[0]!;
    if (SYLLABUS.test(folder)) syllabus++;
    else if (PYQS.test(folder)) pyqs++;
    else if (UNIT.test(folder)) units.set(folder, (units.get(folder) ?? 0) + 1);
    else other.add(folder);
  }
  const unitList = [...units.entries()]
    .map(([name, n]) => ({ name, files: n }))
    .sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
  const missing: string[] = [];
  if (!syllabus) missing.push('a Syllabus folder with the official syllabus');
  if (!unitList.length) missing.push('one folder per unit or module (e.g. "Unit 1 - Introduction")');
  if (loose) missing.push(`a folder for the ${loose} loose file${loose === 1 ? '' : 's'} at the top`);
  return {
    subject,
    syllabus,
    units: unitList,
    pyqs,
    other: [...other].sort(),
    loose,
    wholeSubject: syllabus > 0 && unitList.length > 0,
    missing,
  };
}
