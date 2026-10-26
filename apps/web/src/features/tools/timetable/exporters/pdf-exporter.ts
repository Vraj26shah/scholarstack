import { drawTimetable } from './draw';
import { download, imagePdf } from './pdf';
import type { TimetableExporter } from './types';

/** A real PDF file, made in the browser: one A4 landscape page, ready to print or keep. */
export const pdfExporter: TimetableExporter = {
  id: 'pdf',
  label: 'Download PDF',
  primary: true,
  export: async (courses) => {
    const canvas = drawTimetable(courses);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    if (!blob) throw new Error('This browser could not draw the timetable.');
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    download(imagePdf(jpeg, canvas.width, canvas.height), 'timetable.pdf', 'application/pdf');
  },
};
