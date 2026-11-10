import * as Dialog from '@radix-ui/react-dialog';
import type { CourseUnitDto } from '@ss/contracts';
import { type TouchEvent as ReactTouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../../shared/ui/button';
import { ChevronLeft, ChevronRight, Cross, Eye } from '../../shared/ui/icons';
import { PagePreview } from '../../shared/ui/page-image';
import { ScrambledPage } from '../../shared/ui/scrambled-page';

interface Peek {
  unit: CourseUnitDto;
  fileId: string;
  fileName: string;
  page: number;
}

/** Every free page, unit by unit: the admin's chosen pages, or page 1 of each unit. */
export function peeksOf(units: CourseUnitDto[]): Peek[] {
  return units.flatMap((u) => {
    if (!u.previewFileId) return [];
    const file = u.files.find((f) => f.id === u.previewFileId);
    return (u.previewPages ?? [1]).map((page) => ({
      unit: u,
      fileId: u.previewFileId!,
      fileName: file?.name ?? '',
      page,
    }));
  });
}

/** Page 1 comes from the ready-made preview image; other chosen pages are drawn on a canvas. */
function PeekPage({ peek, className, full }: { peek: Peek; className: string; full?: boolean }) {
  return peek.page === 1 ? (
    <PagePreview
      fileId={peek.fileId}
      crop={full ? 'full' : 'top'}
      eager={full}
      alt={`Page 1 of ${peek.fileName}`}
      className={className}
    />
  ) : (
    <ScrambledPage
      fileId={peek.fileId}
      page={peek.page}
      label={`Page ${peek.page} of ${peek.fileName}`}
      className={className}
    />
  );
}

/**
 * "Peek inside": the first page of every unit, before you buy. Thumbnails sit in a row; tapping one opens a large view you can flip through unit by unit.
 */
export function PreviewGallery({
  units,
  owned,
  onBuy,
  buyLabel,
  className = 'mt-8 sm:mt-10',
}: {
  units: CourseUnitDto[];
  owned: boolean;
  onBuy?: () => void;
  buyLabel?: string;
  className?: string;
}) {
  const peeks = peeksOf(units);
  const [open, setOpen] = useState<number | null>(null);
  const touchStart = useRef<{ x: number; y: number; at: number } | null>(null);

  const step = useCallback(
    (d: number) => setOpen((i) => (i === null ? i : (i + d + peeks.length) % peeks.length)),
    [peeks.length],
  );
  const startPreviewSwipe = useCallback((e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) {
      touchStart.current = null;
      return;
    }
    const touch = e.touches[0]!;
    touchStart.current = { x: touch.clientX, y: touch.clientY, at: Date.now() };
  }, []);
  const finishPreviewSwipe = useCallback(
    (e: ReactTouchEvent<HTMLDivElement>) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start || e.changedTouches.length !== 1 || peeks.length < 2) return;

      const touch = e.changedTouches[0]!;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      const distance = Math.abs(dx);
      const threshold = Math.max(44, Math.min(80, e.currentTarget.clientWidth * 0.14));
      const quickFlick = Date.now() - start.at < 260 && distance > 32;
      if (distance < threshold && !quickFlick) return;
      if (distance < Math.abs(dy) * 1.25) return;

      step(dx < 0 ? 1 : -1);
    },
    [peeks.length, step],
  );
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  if (peeks.length === 0) return null;
  const current = open === null ? null : peeks[open];

  return (
    <section aria-labelledby="peek-title" className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2
          id="peek-title"
          className="m-0 font-display font-extrabold text-[clamp(28px,3.6vw,40px)] tracking-[-0.045em] leading-none"
        >
          Peek inside
        </h2>
        <span className="text-sm text-ink2">
          Free pages from every unit{peeks.length > 1 ? ` · ${peeks.length} pages` : ''}
        </span>
      </div>
      {/* A grid that fills its column: every unit's page in sight, no sideways scrolling. */}
      <ul className="list-none m-0 p-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-4 pt-1">
        {peeks.map((p, i) => (
          <li key={`${p.fileId}-${p.page}`} className="deal-in min-w-0" style={{ ['--i' as string]: i }}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Preview page ${p.page} of ${p.unit.label}: ${p.unit.title}`}
              className="group block w-full p-0 border-0 bg-transparent text-left cursor-zoom-in"
            >
              <span className="block relative rounded-lg overflow-hidden bg-white shadow-[0_18px_34px_-20px_var(--shadow),0_0_0_1px_var(--line)] lift">
                <PeekPage peek={p} className="w-full aspect-[1/1.414]" />
                <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent" />
                <span className="absolute left-2.5 bottom-2.5 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/95 text-[#161B3A] text-xs font-semibold">
                  <Eye size={14} /> Look
                </span>
              </span>
              <span className="mt-3 flex items-center gap-2">
                <span className="flex-none whitespace-nowrap font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-brand text-white">
                  {p.unit.label}
                </span>
                <span className="text-[15px] font-semibold truncate">{p.unit.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(6,9,26,0.82)] backdrop-blur-sm" />
          <Dialog.Content className="fixed z-50 inset-0 flex flex-col items-center justify-center gap-4 p-3 sm:p-6 outline-none">
            {current && (
              <>
                <div className="w-full max-w-[680px] flex items-center justify-between gap-3 text-white">
                  <Dialog.Title className="m-0 flex items-center gap-2.5 min-w-0">
                    <span className="font-mono text-xs font-semibold px-2 py-1 rounded-md bg-mist text-on-mist flex-none">
                      {current.unit.label}
                    </span>
                    <span className="font-display font-extrabold text-xl sm:text-2xl tracking-[-0.03em] truncate">
                      {current.unit.title}
                    </span>
                  </Dialog.Title>
                  <Dialog.Close
                    aria-label="Close preview"
                    className="flex-none w-11 h-11 rounded-full border-0 bg-white/15 text-white inline-flex items-center justify-center cursor-pointer"
                  >
                    <Cross size={18} />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">
                  Page {current.page} of {current.fileName}. Swipe left or right on a phone, or use the arrow
                  keys, to see the other free pages.
                </Dialog.Description>
                <div
                  className="relative w-full max-w-[680px] flex-1 min-h-0 flex items-center justify-center"
                  onTouchStart={startPreviewSwipe}
                  onTouchEnd={finishPreviewSwipe}
                  onTouchCancel={() => {
                    touchStart.current = null;
                  }}
                  style={{ touchAction: 'pan-y' }}
                >
                  <PeekPage
                    key={`${current.fileId}-${current.page}`}
                    peek={current}
                    full
                    className="pop-in h-full max-h-full aspect-[1/1.414] max-w-full rounded-lg bg-white shadow-2xl"
                  />
                </div>
                <div className="w-full max-w-[680px] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Previous free page"
                      className="w-11 h-11 rounded-full border-0 bg-white/15 text-white inline-flex items-center justify-center cursor-pointer"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <span className="font-mono text-sm text-white/80 w-14 text-center">
                      {(open ?? 0) + 1} / {peeks.length}
                    </span>
                    <button
                      type="button"
                      onClick={() => step(1)}
                      aria-label="Next free page"
                      className="w-11 h-11 rounded-full border-0 bg-white/15 text-white inline-flex items-center justify-center cursor-pointer"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  {!owned && onBuy && (
                    <Button
                      variant="buy"
                      onClick={() => {
                        setOpen(null);
                        onBuy();
                      }}
                    >
                      {buyLabel ?? 'Buy to read every page'}
                    </Button>
                  )}
                </div>
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
