import type { TimetableExporter } from './types';

/** The browser's print dialog; styles.css prints only the grid, landscape (Save as PDF works). */
export const printExporter: TimetableExporter = {
  id: 'print',
  label: 'Print or PDF',
  export: () => window.print(),
};
