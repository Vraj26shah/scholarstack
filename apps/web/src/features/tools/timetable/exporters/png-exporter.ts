import { drawTimetable } from './draw';
import { download } from './pdf';
import type { TimetableExporter } from './types';

/** The timetable as a PNG picture (for WhatsApp, a phone wallpaper). */
export const pngExporter: TimetableExporter = {
  id: 'png',
  label: 'Image',
  export: (courses) =>
    new Promise<void>((resolve) =>
      drawTimetable(courses).toBlob((blob) => {
        if (blob) download(blob, 'timetable.png', 'image/png');
        resolve();
      }, 'image/png'),
    ),
};
