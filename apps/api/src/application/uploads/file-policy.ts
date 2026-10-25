import { CONTRIBUTION_LIMITS, SUPPORT_LIMITS } from '@ss/contracts';

/**
 * What may be uploaded, judged by the file's name *and* its first bytes, so a renamed program or
 * web page can't pass as a PDF. One job: say yes or no, and why.
 */
const SIGNATURES: { kind: string; type: string; bytes: number[] }[] = [
  { kind: 'pdf', type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { kind: 'zip', type: 'application/zip', bytes: [0x50, 0x4b, 0x03, 0x04] }, // zip, docx, pptx
  { kind: 'ole', type: 'application/x-ole-storage', bytes: [0xd0, 0xcf, 0x11, 0xe0] }, // doc, ppt
  { kind: 'jpg', type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { kind: 'png', type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47] },
];

const EXTENSION_KIND: Record<string, string> = {
  pdf: 'pdf',
  zip: 'zip',
  docx: 'zip',
  pptx: 'zip',
  doc: 'ole',
  ppt: 'ole',
  jpg: 'jpg',
  jpeg: 'jpg',
  png: 'png',
};

const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

/** A file name that's safe as part of a storage key and in a download header. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^\w.\- ()]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 100);
  return cleaned || 'file';
}

export type FileCheck = { ok: true; name: string; contentType: string } | { ok: false; reason: string };

/** Which files one kind of upload accepts. New upload kinds add a policy, not new checks. */
export interface UploadPolicy {
  extensions: readonly string[];
  maxBytes: number;
  /** "PDF, PowerPoint, Word, zip, JPG or PNG files can be shared" */
  allowed: string;
}

export const CONTRIBUTION_POLICY: UploadPolicy = {
  extensions: CONTRIBUTION_LIMITS.extensions,
  maxBytes: CONTRIBUTION_LIMITS.bytesPerFile,
  allowed: 'PDF, PowerPoint, Word, zip, JPG or PNG files can be shared',
};

export const SUPPORT_POLICY: UploadPolicy = {
  extensions: ['png', 'jpg', 'jpeg', 'pdf'],
  maxBytes: SUPPORT_LIMITS.bytesPerFile,
  allowed: 'screenshots (PNG or JPG) or a PDF can be attached',
};

export function checkFile(
  name: string,
  bytes: Uint8Array,
  policy: UploadPolicy = CONTRIBUTION_POLICY,
): FileCheck {
  const clean = safeFileName(name);
  const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : '';
  if (!policy.extensions.includes(ext)) return { ok: false, reason: `${clean}: only ${policy.allowed}.` };
  if (bytes.byteLength === 0) return { ok: false, reason: `${clean} is empty.` };
  if (bytes.byteLength > policy.maxBytes)
    return { ok: false, reason: `${clean} is over ${policy.maxBytes / 1024 / 1024} MB.` };
  const expected = EXTENSION_KIND[ext];
  const actual = SIGNATURES.find((s) => s.bytes.every((b, i) => bytes[i] === b))?.kind;
  if (actual !== expected) return { ok: false, reason: `${clean} isn't really a .${ext} file.` };
  return { ok: true, name: clean, contentType: CONTENT_TYPE[ext]! };
}
