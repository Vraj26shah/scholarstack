import { CONTRIBUTION_LIMITS, type ContributionKind } from '@ss/contracts';

/**
 * The client-side copy of the upload rules. The server checks everything again (including what
 * each file really is), so this exists only to tell students early and kindly.
 */
export const ACCEPTED = [
  'zip',
  'pdf',
  'ppt',
  'pptx',
  'pps',
  'ppsx',
  'odp',
  'doc',
  'docx',
  'odt',
  'txt',
  'jpg',
  'jpeg',
  'png',
] as const;
export const ACCEPT_ATTR = ACCEPTED.map((e) => `.${e}`).join(',');

export const KIND_LABEL: Record<ContributionKind, string> = {
  notes: 'Class notes',
  pyq: 'Past papers',
  slides: 'Slides',
  lab: 'Lab work',
  other: 'Something else',
};

export const MB = 1024 * 1024;

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${Math.round(n / 1024)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

const ext = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

/** Problems with a list of files, as sentences a student can act on. Empty when it's fine. */
export function problemsWith(files: File[], limits = CONTRIBUTION_LIMITS): string[] {
  const out: string[] = [];
  if (files.length > limits.filesPerSubmission)
    out.push(
      limits.filesPerSubmission < 2
        ? 'Choose one file.'
        : `Choose up to ${limits.filesPerSubmission} files. Remove: ${files
            .slice(limits.filesPerSubmission)
            .map((file) => file.name)
            .join(', ')}.`,
    );
  for (const f of files) {
    if (!(ACCEPTED as readonly string[]).includes(ext(f.name)))
      out.push(`${f.name}: choose PDF, Word, PowerPoint, text, image or ZIP files.`);
    if (f.size > limits.bytesPerFile)
      out.push(
        `${f.name} is ${formatBytes(f.size)}; the per-file limit is ${formatBytes(limits.bytesPerFile)}. ${ext(f.name) === 'zip' ? 'Make smaller ZIPs by unit or module, then upload them separately.' : 'Choose a smaller file.'}`,
      );
    if (f.size === 0) out.push(`${f.name} is empty.`);
  }
  // Files already refused for their type or size are not counted towards the total.
  const counted = files.filter(
    (f) => (ACCEPTED as readonly string[]).includes(ext(f.name)) && f.size <= limits.bytesPerFile,
  );
  const total = counted.reduce((t, f) => t + f.size, 0);
  if (total > limits.bytesPerSubmission) {
    let remaining = total;
    const remove: File[] = [];
    for (const file of [...counted].sort((a, b) => b.size - a.size)) {
      if (remaining <= limits.bytesPerSubmission) break;
      remove.push(file);
      remaining -= file.size;
    }
    out.push(
      `These files total ${formatBytes(total)}; the limit is ${formatBytes(limits.bytesPerSubmission)}. To fit, remove or upload separately: ${remove.map((file) => `${file.name} (${formatBytes(file.size)})`).join(', ')}.`,
    );
  }
  return out;
}

const supported = (f: File) =>
  (ACCEPTED as readonly string[]).includes(f.name.split('.').pop()?.toLowerCase() ?? '');

/**
 * Add newly picked files, skipping exact repeats (same name and size). A file already turned away
 * for its type is dropped on the next pick, so a student never has to hunt for it to send again.
 */
export function mergeFiles(current: File[], added: File[]): File[] {
  const kept = current.filter(supported);
  const seen = new Set(kept.map((f) => `${f.name}|${f.size}`));
  return [...kept, ...added.filter((f) => !seen.has(`${f.name}|${f.size}`))];
}

export interface FileIssue {
  name: string;
  size: number;
  why: string;
}

/**
 * What each picked file breaks, by file, so the picker can mark the exact row: the wrong type,
 * too big on its own, empty, past the file count, or one of the largest files that push the
 * total over the limit. Keyed by `${name}|${size}`.
 */
export function fileIssues(files: File[], limits = CONTRIBUTION_LIMITS): Map<string, string> {
  const out = new Map<string, string>();
  const key = (f: File) => `${f.name}|${f.size}`;
  files.forEach((f, i) => {
    if (!(ACCEPTED as readonly string[]).includes(ext(f.name))) out.set(key(f), 'File type not accepted');
    else if (f.size === 0) out.set(key(f), 'Empty file');
    else if (f.size > limits.bytesPerFile)
      out.set(key(f), `Too big: over the ${formatBytes(limits.bytesPerFile)} per-file limit`);
    else if (i >= limits.filesPerSubmission)
      out.set(key(f), `Over the ${limits.filesPerSubmission}-file limit`);
  });
  const counted = files.filter((f) => !out.has(key(f)));
  let total = counted.reduce((t, f) => t + f.size, 0);
  for (const f of [...counted].sort((a, b) => b.size - a.size)) {
    if (total <= limits.bytesPerSubmission) break;
    out.set(key(f), `Pushes the total over ${formatBytes(limits.bytesPerSubmission)}: send it separately`);
    total -= f.size;
  }
  return out;
}

/**
 * Split an admin upload into requests the server accepts: files that can't go (type or size) are
 * named with the reason, the rest are grouped so no request passes `perRequest` bytes.
 */
export function planUpload(
  files: File[],
  { extensions, perFile, perRequest }: { extensions: readonly string[]; perFile: number; perRequest: number },
): { batches: File[][]; skipped: FileIssue[] } {
  const skipped: FileIssue[] = [];
  const batches: File[][] = [];
  let current: File[] = [];
  let size = 0;
  for (const f of files) {
    const why = !extensions.includes(ext(f.name))
      ? `not accepted here (use ${extensions.join(', ').toUpperCase()})`
      : f.size === 0
        ? 'empty file'
        : f.size > perFile
          ? `${formatBytes(f.size)}, over the ${formatBytes(perFile)} per-file limit — compress or split it`
          : null;
    if (why) {
      skipped.push({ name: f.name, size: f.size, why });
      continue;
    }
    if (current.length && size + f.size > perRequest) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(f);
    size += f.size;
  }
  if (current.length) batches.push(current);
  return { batches, skipped };
}
