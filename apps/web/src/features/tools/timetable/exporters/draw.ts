import { type Course, GRID, LUNCH_AFTER, PERIODS } from '../domain';

/** Fit text into a width, adding "…" when it doesn't. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t}…`;
}

/**
 * The week as a picture: brand and title on top, the slot grid with each course's code, name,
 * room and lecturer, and where it was made at the bottom. Used for the image and the PDF.
 */
export function drawTimetable(courses: Course[], title = 'My timetable'): HTMLCanvasElement {
  const scale = 2;
  const dayW = 120;
  const colW = 162;
  const lunchW = 40;
  const headH = 58;
  const rowH = 92;
  const pad = 28;
  const topH = 70;
  const footH = 40;
  const width = pad * 2 + dayW + PERIODS.length * colW + lunchW;
  const height = pad * 2 + topH + headH + GRID.length * rowH + footH;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(scale, scale);
  const font = (w: number, s: number, family = 'Geist, system-ui, sans-serif') => `${w} ${s}px ${family}`;
  const ink = '#161B3A';
  const muted = '#4D5675';

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  // Brand line and title.
  ctx.fillStyle = '#2F3C7E';
  ctx.fillRect(pad, pad, 10, 34);
  ctx.fillStyle = '#1995AD';
  ctx.fillRect(pad + 14, pad, 10, 34);
  ctx.fillStyle = ink;
  ctx.font = font(800, 26, 'Fraunces, Georgia, serif');
  ctx.fillText(title, pad + 36, pad + 27);
  ctx.font = font(600, 13);
  ctx.fillStyle = muted;
  const brand = 'SCHOLARS STACK · TIMETABLE';
  ctx.fillText(brand, width - pad - ctx.measureText(brand).width, pad + 22);

  const top = pad + topH;
  const colX = (i: number) => pad + dayW + i * colW + (i >= LUNCH_AFTER ? lunchW : 0);
  const taken = new Map<string, Course>();
  for (const c of courses) for (const s of c.slots) if (!taken.has(s) || !c.tentative) taken.set(s, c);

  PERIODS.forEach((p, i) => {
    ctx.fillStyle = '#2F3C7E';
    ctx.beginPath();
    ctx.roundRect(colX(i) + 3, top, colW - 6, headH - 8, 8);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(700, 13);
    ctx.fillText(`Slot ${p.n}`, colX(i) + 14, top + 21);
    ctx.font = font(500, 12);
    ctx.fillText(p.time, colX(i) + 14, top + 39);
  });
  const lunchX = pad + dayW + LUNCH_AFTER * colW;
  ctx.fillStyle = '#F1F1F2';
  ctx.fillRect(lunchX + 4, top, lunchW - 8, headH - 8 + GRID.length * rowH);
  ctx.save();
  ctx.translate(lunchX + lunchW / 2 + 4, top + (headH + GRID.length * rowH) / 2 + 20);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = muted;
  ctx.font = font(700, 12);
  ctx.fillText('LUNCH', 0, 0);
  ctx.restore();

  GRID.forEach((d, r) => {
    const y = top + headH + r * rowH;
    ctx.fillStyle = ink;
    ctx.font = font(700, 15);
    ctx.fillText(d.day, pad + 2, y + rowH / 2 + 5);
    d.slots.forEach((slot, i) => {
      const x = colX(i) + 3;
      const w = colW - 6;
      const c = taken.get(slot);
      ctx.beginPath();
      ctx.roundRect(x, y + 4, w, rowH - 8, 10);
      ctx.fillStyle = c && !c.tentative ? c.color : '#FFFFFF';
      ctx.fill();
      if (c?.tentative) {
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = `${c.color}`;
        ctx.lineWidth = 5;
        for (let k = -rowH; k < w; k += 12) {
          ctx.beginPath();
          ctx.moveTo(x + k, y + rowH);
          ctx.lineTo(x + k + rowH, y);
          ctx.stroke();
        }
        ctx.restore();
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = c ? 'rgba(22,27,58,0.12)' : '#D9DCE6';
      if (c?.tentative) ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.roundRect(x + 0.5, y + 4.5, w - 1, rowH - 9, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = c ? ink : '#9AA0B5';
      ctx.font = font(600, 11, 'JetBrains Mono, ui-monospace, monospace');
      ctx.fillText(slot + (c?.tentative ? ' · planned' : ''), x + 10, y + 22);
      if (c) {
        const inner = w - 20;
        ctx.font = font(800, 15);
        ctx.fillText(fit(ctx, c.code || c.name, inner), x + 10, y + 43);
        ctx.font = font(500, 12);
        const lines = [c.code ? c.name : '', c.room ?? '', c.teacher].filter(Boolean).slice(0, 2);
        lines.forEach((line, k) => ctx.fillText(fit(ctx, line, inner), x + 10, y + 61 + k * 15));
      }
    });
  });

  ctx.font = font(500, 12);
  ctx.fillStyle = muted;
  const where = `Made free with Scholars Stack · ${location.host}/tools/timetable`;
  ctx.fillText(where, pad, height - pad + 4);
  return canvas;
}
