import { TILE_GRID, unscrambleMoves } from '@ss/contracts';
import type { RefObject } from 'react';
import { useLayoutEffect } from 'react';

/**
 * Draws a scrambled page back into order on a canvas, then paints the reader's
 * watermark into the same pixels. No <img> or file URL ever exists in the page.
 */
/**
 * Put a scrambled page's tiles back in order ahead of time (while the reader is still on
 * an earlier page), so turning to it only has to paint one image. Returns null where
 * OffscreenCanvas is missing; the canvas then reorders the tiles itself.
 */
export async function preassemble(bitmap: ImageBitmap, seed: string): Promise<ImageBitmap | null> {
  if (typeof OffscreenCanvas === 'undefined' || !seed) return null;
  const tw = Math.floor(bitmap.width / TILE_GRID);
  const th = Math.floor(bitmap.height / TILE_GRID);
  const off = new OffscreenCanvas(tw * TILE_GRID, th * TILE_GRID);
  const ctx = off.getContext('2d');
  if (!ctx) return null;
  for (const m of unscrambleMoves(seed)) {
    ctx.drawImage(bitmap, m.fromCol * tw, m.fromRow * th, tw, th, m.toCol * tw, m.toRow * th, tw, th);
  }
  return off.transferToImageBitmap();
}

/** The height of each identity band, for a page this tall (in the bitmap's pixels). */
export const bandHeight = (pageHeight: number) => Math.max(26, Math.round(pageHeight / 38));

/** When this page was opened, for the watermark ("07 Nov 2026, 14:32"). */
const stamp = () =>
  new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

/**
 * The reader's identity, painted into the page's own pixels so every screenshot carries it:
 *  - a few faint diagonal lines of "name · email · date time" spread over the page, so a crop of
 *    any useful part still carries one, without getting in the way of reading;
 *  - a solid band at the top and the bottom with the same identity and the sharing warning,
 *    which can't be cropped away without cutting the page.
 */
export function paintWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  watermark: string,
  contributorCredit?: string,
  band = bandHeight(h),
) {
  const [studentName, email] = watermark.split(' · ');
  const who = email ? `${studentName} · ${email}` : watermark;
  const line = `${who} · ${stamp()}`;

  // 1. A sparse diagonal pattern: a few lines per page, offset row to row, so any useful crop
  //    still catches one, while the writing stays clear to read.
  const font = Math.max(16, Math.round(w / 50));
  const rowGap = Math.max(font * 9, h / 5.5);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 7.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${font}px "Inter", sans-serif`;
  const textWidth = ctx.measureText(line).width;
  const colGap = textWidth + font * 10;
  const reach = Math.hypot(w, h);
  // Teal, not the notes' own ink, so the eye separates it from the writing underneath.
  ctx.fillStyle = 'rgba(25, 120, 140, 0.17)';
  let row = 0;
  for (let y = -reach / 2 + rowGap / 2; y <= reach / 2; y += rowGap, row++) {
    const offset = (row % 2) * (colGap / 2);
    for (let x = -reach / 2 - colGap + offset; x <= reach / 2; x += colGap) ctx.fillText(line, x, y);
  }
  ctx.restore();

  // 2. The bands: identity at the top, the warning at the bottom.
  const small = Math.round(band * 0.46);
  ctx.save();
  ctx.fillStyle = 'rgba(47, 60, 126, 0.86)';
  ctx.fillRect(0, 0, w, band);
  ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${small}px "Inter", sans-serif`;
  ctx.fillText(`Licensed to ${who} · ${stamp()}`, w / 2, band / 2, w * 0.94);
  ctx.fillText(
    `Scholars Stack · personal copy of ${studentName}${contributorCredit ? ` · notes by ${contributorCredit}` : ''} · sharing revokes access`,
    w / 2,
    h - band / 2,
    w * 0.94,
  );
  ctx.restore();
}

export function PageCanvas({
  bitmap,
  seed,
  ordered = false,
  watermark,
  contributorCredit,
  night,
  width,
  canvasRef,
}: {
  bitmap: ImageBitmap | null;
  seed: string;
  /** The bitmap's tiles are already in order (see preassemble). */
  ordered?: boolean;
  watermark: string;
  contributorCredit?: string;
  night: boolean;
  /** Display width in CSS pixels (the bitmap keeps its full resolution). */
  width: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap || !seed) return;
    const w = bitmap.width;
    const h = bitmap.height;
    const tw = ordered ? w / TILE_GRID : Math.floor(w / TILE_GRID);
    const th = ordered ? h / TILE_GRID : Math.floor(h / TILE_GRID);
    const pageH = th * TILE_GRID;
    const band = bandHeight(pageH);
    // The identity bands sit above and below the page, never over its content.
    canvas.width = tw * TILE_GRID;
    canvas.height = pageH + band * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ordered) ctx.drawImage(bitmap, 0, band);
    else
      for (const m of unscrambleMoves(seed)) {
        ctx.drawImage(
          bitmap,
          m.fromCol * tw,
          m.fromRow * th,
          tw,
          th,
          m.toCol * tw,
          band + m.toRow * th,
          tw,
          th,
        );
      }
    paintWatermark(ctx, canvas.width, canvas.height, watermark, contributorCredit, band);
  }, [bitmap, seed, ordered, watermark, contributorCredit, canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Note page"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      draggable={false}
      className="reader-note-canvas block h-auto max-w-none rounded-md no-select shadow-[0_34px_60px_-34px_var(--shadow),0_0_0_1px_var(--line)] bg-white"
      style={{
        width: `${Math.round(width)}px`,
        filter: night ? 'invert(0.88) hue-rotate(180deg) contrast(0.95)' : 'none',
      }}
    />
  );
}
