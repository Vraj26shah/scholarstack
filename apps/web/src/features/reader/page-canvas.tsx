import { TILE_GRID, unscrambleMoves } from '@ss/contracts';
import type { RefObject } from 'react';
import { useLayoutEffect } from 'react';

/**
 * Draws a scrambled page back into order on a canvas, then paints the reader's
 * watermark into the same pixels. No <img> or file URL ever exists in the page.
 */
export function PageCanvas({
  bitmap,
  seed,
  watermark,
  night,
  zoom,
  canvasRef,
}: {
  bitmap: ImageBitmap | null;
  seed: string;
  watermark: string;
  night: boolean;
  zoom: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmap || !seed) return;
    const w = bitmap.width;
    const h = bitmap.height;
    const tw = Math.floor(w / TILE_GRID);
    const th = Math.floor(h / TILE_GRID);
    canvas.width = tw * TILE_GRID;
    canvas.height = th * TILE_GRID;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  }, [bitmap, seed, watermark, canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label="Note page"
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className="reader-note-canvas block max-w-full h-auto rounded-md no-select shadow-[0_34px_60px_-34px_var(--shadow),0_0_0_1px_var(--line)] bg-white"
      style={{
        width: `${Math.round(660 * zoom)}px`,
        filter: night ? 'invert(0.88) hue-rotate(180deg) contrast(0.95)' : 'none',
      }}
    />
  );
}
