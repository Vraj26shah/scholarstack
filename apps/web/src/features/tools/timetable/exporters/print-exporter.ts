import { drawTimetable } from './draw';
import type { TimetableExporter } from './types';

/**
 * Prints exactly what the PDF shows: the same picture, alone in a hidden frame, one landscape
 * page. The site's "no printing" rule for notes never applies to that frame, so it needs no
 * exception (and grants none).
 */
export const printExporter: TimetableExporter = {
  id: 'print',
  label: 'Print',
  export: (courses) =>
    new Promise<void>((resolve, reject) => {
      const image = drawTimetable(courses).toDataURL('image/png');
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      frame.srcdoc = `<!doctype html><title>My timetable</title><style>@page{size:A4 landscape;margin:8mm}html,body{margin:0}img{display:block;width:100%;height:auto}</style><img alt="My timetable" src="${image}">`;
      const cleanup = () => setTimeout(() => frame.remove(), 1000);
      frame.onload = () => {
        const win = frame.contentWindow;
        if (!win) {
          frame.remove();
          reject(new Error('no frame'));
          return;
        }
        win.addEventListener('afterprint', cleanup);
        win.focus();
        win.print();
        setTimeout(cleanup, 60_000);
        resolve();
      };
      document.body.appendChild(frame);
    }),
};
