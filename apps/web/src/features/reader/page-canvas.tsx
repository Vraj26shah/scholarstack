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

export function PageCanvas({
  bitmap,
  seed,
  ordered = false,
  watermark,
  night,
  width,
  canvasRef,
}: {
  bitmap: ImageBitmap | null;
  seed: string;
  /** The bitmap's tiles are already in order (see preassemble). */
  ordered?: boolean;
  watermark: string;
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
    canvas.width = tw * TILE_GRID;
    canvas.height = th * TILE_GRID;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (ordered) ctx.drawImage(bitmap, 0, 0);
    else
      for (const m of unscrambleMoves(seed)) {
        ctx.drawImage(bitmap, m.fromCol * tw, m.fromRow * th, tw, th, m.toCol * tw, m.toRow * th, tw, th);
      }
    // Watermark baked into the pixels, diagonally repeated.
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(-Math.PI / 7.5);
    ctx.font = `600 ${Math.round(canvas.width / 46)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = 'rgba(47, 60, 126, 0.13)';
    ctx.textAlign = 'center';
    const step = Math.round(canvas.height / 4.2);
    for (let y = -canvas.height; y <= canvas.height; y += step) {
      ctx.fillText(watermark, 0, y);
    }
    ctx.restore();
  }, [bitmap, seed, ordered, watermark, canvasRef]);

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
