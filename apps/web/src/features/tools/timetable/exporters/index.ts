import { pngExporter } from './png-exporter';
import { printExporter } from './print-exporter';
import type { TimetableExporter } from './types';

export const DEFAULT_EXPORTERS: TimetableExporter[] = [pngExporter, printExporter];
export type { TimetableExporter };
