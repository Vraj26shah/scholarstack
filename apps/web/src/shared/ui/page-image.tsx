import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { reportProblem } from '../../lib/problems';

/**
 * A page-one preview from R2. While it loads (or if it fails, or the course has no preview
 * yet) the frame shows a skeleton — never a broken image or made-up content. A failed load is
 * retried once after a short pause, since previews can still be processing.
 */
export function PagePreview({
  fileId,
  alt = '',
  className = '',
  crop = 'top',
  eager = false,
}: {
  fileId: string | null;
  alt?: string;
  className?: string;
  /** `top` shows the top of the page (cards); `full` shows the whole page (viewer). */
  crop?: 'top' | 'full';
  eager?: boolean;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset whenever a different file is shown
  useEffect(() => {
    setState('loading');
    setAttempt(0);
  }, [fileId]);

  useEffect(() => {
    if (state !== 'failed' || attempt > 0) return;
    const t = setTimeout(() => {
      setAttempt(1);
      setState('loading');
    }, 4000);
    return () => clearTimeout(t);
  }, [state, attempt]);

  const gaveUp = Boolean(fileId) && state === 'failed' && attempt > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: report once per file that gives up
  useEffect(() => {
    if (gaveUp) reportProblem('image', 'A page-one preview would not load', `file ${fileId}`);
  }, [gaveUp]);
  const showImage = fileId && !gaveUp;
  return (
    <div className={`relative overflow-hidden bg-sunk ${className}`}>
      {state !== 'loaded' && !gaveUp && (
        <div className="skeleton absolute inset-0 rounded-none" aria-hidden="true" />
      )}
      {gaveUp && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-xs text-ink2 bg-sunk">
          <span>
            Preview isn’t available right now.
            <br />
            The full file opens in the reader.
          </span>
        </div>
      )}
      {showImage && (
        <img
          key={`${fileId}-${attempt}`}
          src={`${api.previewUrl(fileId)}${attempt ? '&r=1' : ''}`}
          alt={alt}
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          onContextMenu={(e) => e.preventDefault()}
          data-loaded={state === 'loaded' ? '' : undefined}
          className={`img-fade relative block w-full h-full no-select bg-white ${
            crop === 'top' ? 'object-cover object-top' : 'object-contain'
          }`}
        />
      )}
    </div>
  );
}
