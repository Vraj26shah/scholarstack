import { type Course, GRID, LUNCH_AFTER, PERIODS } from '../domain';
import type { TimetableExporter } from './types';

/** Draws the timetable onto a canvas and downloads it as a PNG (no outside libraries). */
function downloadPng(courses: Course[], title = 'My timetable') {
  const scale = 2;
  const dayW = 130;
  const colW = 150;
  const lunchW = 44;
  const headH = 64;
  const rowH = 78;
  const pad = 24;
  const titleH = 48;
  const width = pad * 2 + dayW + PERIODS.length * colW + lunchW;
  const height = pad * 2 + titleH + headH + GRID.length * rowH;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(scale, scale);
  const font = (w: number, s: number) => `${w} ${s}px Geist, system-ui, sans-serif`;
  ctx.fillStyle = '#F1F1F2';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#161B3A';
  ctx.font = font(800, 22);
  ctx.fillText(title, pad, pad + 26);
  ctx.font = font(500, 12);
  ctx.fillStyle = '#4D5675';
  ctx.fillText('Scholars Stack · Timetable maker', width - pad - 210, pad + 26);

  const top = pad + titleH;
  const colX = (i: number) => pad + dayW + i * colW + (i >= LUNCH_AFTER ? lunchW : 0);
  const taken = new Map<string, Course>();
  for (const c of courses) for (const s of c.slots) if (!taken.has(s) || !c.tentative) taken.set(s, c);

  ctx.font = font(700, 13);
  PERIODS.forEach((p, i) => {
    ctx.fillStyle = '#2F3C7E';
    ctx.fillRect(colX(i) + 2, top, colW - 4, headH - 6);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(`Slot ${p.n}`, colX(i) + 12, top + 24);
    ctx.font = font(500, 12);
    ctx.fillText(p.time, colX(i) + 12, top + 44);
    ctx.font = font(700, 13);
  });
  ctx.fillStyle = '#E4E6EE';
  ctx.fillRect(pad + dayW + LUNCH_AFTER * colW + 2, top, lunchW - 4, headH - 6 + GRID.length * rowH);
  ctx.save();
  ctx.translate(pad + dayW + LUNCH_AFTER * colW + lunchW / 2 + 4, top + headH + (GRID.length * rowH) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = '#4D5675';
  ctx.font = font(700, 12);
  ctx.fillText('LUNCH', -20, 0);
  ctx.restore();

  GRID.forEach((d, r) => {
    const y = top + headH + r * rowH;
    ctx.fillStyle = '#161B3A';
    ctx.font = font(700, 14);
    ctx.fillText(d.day, pad + 4, y + rowH / 2 + 5);
    d.slots.forEach((slot, i) => {
      const x = colX(i) + 2;
      const c = taken.get(slot);
      ctx.fillStyle = c ? c.color : '#FFFFFF';
      ctx.fillRect(x, y + 3, colW - 4, rowH - 6);
      ctx.strokeStyle = '#D9DCE6';
      if (c?.tentative) ctx.setLineDash([5, 4]);
      ctx.strokeRect(x + 0.5, y + 3.5, colW - 5, rowH - 7);
      ctx.setLineDash([]);
      ctx.fillStyle = c ? '#161B3A' : '#9AA0B5';
      ctx.font = font(600, 11);
      ctx.fillText(slot + (c?.tentative ? ' · planned' : ''), x + 10, y + 22);
      if (c) {
        ctx.font = font(700, 14);
        ctx.fillText((c.code || c.name).slice(0, 18), x + 10, y + 44);
        ctx.font = font(500, 11);
        const sub = c.code ? c.name : c.teacher;
        if (sub) ctx.fillText(sub.slice(0, 22), x + 10, y + 62);
      }
    });
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'timetable.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, 'image/png');
}

export const pngExporter: TimetableExporter = {
  id: 'png',
  label: 'Save as image',
  export: (courses) => downloadPng(courses),
};
