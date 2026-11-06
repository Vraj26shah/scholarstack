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

/** ₹1,23,456 (Indian grouping), with paise only when there are any. */
export function formatMoney(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
