import { TILE_GRID, unscrambleMoves } from '@ss/contracts';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';

/**
 * One page drawn back into order on a canvas: a unit's free preview page (public), or any page
 * of a file for an admin choosing previews. No image URL of the page ever exists in the page.
 */
export function ScrambledPage({
  fileId,
  page,
  admin = false,
  stamp = 'PREVIEW',
  className = '',
  label,
}: {
  fileId: string;
  page: number;
  admin?: boolean;
  /** Painted across the page; empty for none. */
  stamp?: string;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    (async () => {
      try {
        const { blob, seed } = await api.previewPage(fileId, page, admin);
        const bitmap = await createImageBitmap(blob);
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        const tw = Math.floor(bitmap.width / TILE_GRID);
        const th = Math.floor(bitmap.height / TILE_GRID);
        canvas.width = tw * TILE_GRID;
        canvas.height = th * TILE_GRID;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (seed)
          for (const m of unscrambleMoves(seed))
            ctx.drawImage(bitmap, m.fromCol * tw, m.fromRow * th, tw, th, m.toCol * tw, m.toRow * th, tw, th);
        else ctx.drawImage(bitmap, 0, 0);
        if (stamp) {
          ctx.save();
          ctx.translate(canvas.width / 2, canvas.height / 2);
          ctx.rotate(-Math.PI / 7.5);
          ctx.font = `700 ${Math.round(canvas.width / 9)}px "JetBrains Mono", monospace`;
          ctx.fillStyle = 'rgba(47, 60, 126, 0.12)';
          ctx.textAlign = 'center';
          ctx.fillText(stamp, 0, 0);
          ctx.restore();
        }
        bitmap.close();
        setState('ready');
      } catch {
        if (!cancelled) setState('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileId, page, admin, stamp]);

  return (
    <div className={`relative overflow-hidden bg-white ${className}`}>
      {state === 'loading' && <div className="skeleton absolute inset-0 rounded-none" aria-hidden="true" />}
      {state === 'failed' && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-ink2 bg-sunk">
          This page isn’t available.
        </div>
      )}
      <canvas
        ref={ref}
        role="img"
        aria-label={label ?? `Page ${page}`}
        onContextMenu={(e) => e.preventDefault()}
        className={`block w-full h-auto no-select ${state === 'ready' ? '' : 'invisible'}`}
      />
    </div>
  );
}
