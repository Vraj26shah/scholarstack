import { CONTRIBUTION_LIMITS, type ContributionKind } from '@ss/contracts';

/**
 * The client-side copy of the upload rules. The server checks everything again (including what
 * each file really is), so this exists only to tell students early and kindly.
 */
export const ACCEPTED = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'zip', 'jpg', 'jpeg', 'png'] as const;
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
    out.push(`Up to ${limits.filesPerSubmission} files at a time. Zip the rest together.`);
  for (const f of files) {
    if (!(ACCEPTED as readonly string[]).includes(ext(f.name)))
      out.push(`${f.name}: only PDF, PowerPoint, Word, ZIP and JPG/PNG files.`);
    else if (f.size > limits.bytesPerFile)
      out.push(
        `${f.name} is ${formatBytes(f.size)}. Each file must be under ${limits.bytesPerFile / MB} MB.`,
      );
    else if (f.size === 0) out.push(`${f.name} is empty.`);
  }
  const total = files.reduce((t, f) => t + f.size, 0);
  if (total > limits.bytesPerSubmission)
    out.push(
      `All files together are ${formatBytes(total)}; the limit is ${limits.bytesPerSubmission / MB} MB.`,
    );
  return out;
}

/** Add newly picked files, skipping exact repeats (same name and size). */
export function mergeFiles(current: File[], added: File[]): File[] {
  const seen = new Set(current.map((f) => `${f.name}|${f.size}`));
  return [...current, ...added.filter((f) => !seen.has(`${f.name}|${f.size}`))];
}
