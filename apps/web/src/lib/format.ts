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

/** "14 Nov", or "14 Nov, 11:59 pm" when it ends today. */
export function offerEnds(iso: string): string {
  const end = new Date(iso);
  const day = end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return end.toDateString() === new Date().toDateString()
    ? `${day}, ${end.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
    : day;
}
