import type { FileFormat } from '@ss/contracts';

export { formatBytes, formatRupees } from '@ss/contracts';

export const FORMAT_LABEL: Record<FileFormat, string> = {
  pdf: 'PDF',
  pptx: 'PPT',
  docx: 'DOC',
  image: 'IMG',
};

export function fileFormatLabel(format: FileFormat, name: string): string {
  return name.toLowerCase().endsWith('.txt') ? 'TXT' : FORMAT_LABEL[format];
}

export function formatsLabel(formats: FileFormat[]): string {
  return formats.map((f) => FORMAT_LABEL[f]).join(' + ') || '—';
}
