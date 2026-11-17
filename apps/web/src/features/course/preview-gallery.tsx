import * as Dialog from '@radix-ui/react-dialog';
import type { CourseUnitDto, FileFormat } from '@ss/contracts';
import { type TouchEvent as ReactTouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { track } from '../../lib/analytics';
import { FORMAT_UNIT, type FormatKind, formatKind } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { FormatBadge } from '../../shared/ui/format-badge';
import { ChevronLeft, ChevronRight, Cross, Eye } from '../../shared/ui/icons';
import { PagePreview } from '../../shared/ui/page-image';
import { ScrambledPage } from '../../shared/ui/scrambled-page';
import { SwipeHint } from '../../shared/ui/swipe-hint';

interface Peek {
  unit: CourseUnitDto;
  fileId: string;
  fileName: string;
  format: FileFormat;
  pageCount: number;
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
      format: file?.format ?? 'pdf',
      pageCount: file?.pageCount ?? 1,
      page,
    }));
  });
}

const kindOf = (peek: Peek): FormatKind => formatKind(peek.format, peek.fileName);
/** "Slide 3" for decks, "Page 12" for everything else. */
const unitWord = (peek: Peek) => FORMAT_UNIT[kindOf(peek)];

/** Page 1 comes from the ready-made preview image; other chosen pages are drawn on a canvas. */
function PeekPage({
  peek,
  className,
  full,
  fit,
}: { peek: Peek; className: string; full?: boolean; fit?: 'auto' }) {
  return peek.page === 1 ? (
    <PagePreview
      fileId={peek.fileId}
      crop={full ? 'full' : (fit ?? 'top')}
      eager={full}
      alt={`${unitWord(peek)} 1 of ${peek.fileName}`}
      className={className}
    />
  ) : (
    <ScrambledPage
      fileId={peek.fileId}
      page={peek.page}
      label={`${unitWord(peek)} ${peek.page} of ${peek.fileName}`}
      fit={full ? 'contain' : (fit ?? 'width')}
      className={className}
    />
  );
}

/**
 * "Peek inside": free pages from every unit, before you buy. Thumbnails sit in a grid; tapping
 * one opens a large view you can flip through unit by unit — swiping on a phone, arrows anywhere.
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
      {/*
        Every free page in one even grid, in unit order. Each card has the same 4:3 frame whatever
        the file is, so rows line up with no gaps: a portrait page fills it from the top (its title
        readable), a slide (PPT, or a PDF of slides) shows whole. Labels sit under the picture,
        never on top of the page.
      */}
      <ul className="list-none m-0 p-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-5 pt-1">
        {peeks.map((p, i) => (
          <li key={`${p.fileId}-${p.page}`} className="deal-in min-w-0" style={{ ['--i' as string]: i }}>
            <button
              type="button"
              onClick={() => {
                setOpen(i);
                track('peek_open', { format: kindOf(p), unit: p.unit.label });
              }}
              aria-label={`Preview ${unitWord(p).toLowerCase()} ${p.page} of ${p.unit.label}: ${p.unit.title}`}
              className="group flex flex-col w-full h-full p-0 rounded-xl overflow-hidden border border-line bg-surface text-left cursor-zoom-in lift shadow-[0_14px_28px_-22px_var(--shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            >
              <span className="relative block aspect-[4/3] overflow-hidden bg-sunk border-b border-line">
                {/* Absolute, so the page can't stretch the frame (an aspect box grows to its content). */}
                <span className="absolute inset-0">
                  <PeekPage peek={p} fit="auto" className="w-full h-full" />
                </span>
                {/* Pointer: a "Look" pill on hover. Touch: the small eye below is always there. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 grid place-items-center bg-[rgba(22,27,58,0)] transition-colors duration-200 group-hover:bg-[rgba(22,27,58,0.28)]"
                >
                  <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white text-[#161B3A] text-[13px] font-semibold shadow-md opacity-0 translate-y-1 transition duration-200 group-hover:opacity-100 group-hover:translate-y-0">
                    <Eye size={15} /> Look inside
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="absolute right-2 bottom-2 grid place-items-center w-8 h-8 rounded-full bg-white/95 text-[#161B3A] shadow-sm transition-opacity group-hover:opacity-0"
                >
                  <Eye size={15} />
                </span>
              </span>
              <span className="flex flex-1 flex-col gap-2 p-3">
                {/* Chip above the title, so the title has the card's full width (no mid-word breaks). */}
                <span className="self-start whitespace-nowrap font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-brand text-white">
                  {p.unit.label}
                </span>
                <span className="text-[15px] font-semibold leading-snug line-clamp-2" title={p.unit.title}>
                  {p.unit.title}
                </span>
                <span className="mt-auto flex items-center gap-1.5 min-w-0 text-[12.5px] text-ink2">
                  <FormatBadge format={p.format} name={p.fileName} sm />
                  <span className="truncate">
                    {unitWord(p)} {p.page} of {p.pageCount}
                  </span>
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(6,9,26,0.82)] backdrop-blur-sm" />
          <Dialog.Content className="fixed z-50 inset-0 flex flex-col items-center justify-center gap-3 sm:gap-4 p-3 sm:p-6 outline-none">
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
                  {unitWord(current)} {current.page} of {current.fileName}. Swipe left or right on a phone, or
                  use the arrow keys, to see the other free pages.
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
                    // The whole frame; the page sits inside it at its real shape (a PDF of slides
                    // shows wide, a page tall), never squeezed into a shape picked by file type.
                    className="pop-in w-full h-full"
                  />
                </div>
                {/* Phones only; shows the first few times per device. */}
                <div className="flex justify-center">
                  <SwipeHint id="peek-flip" floating>
                    Swipe for the next free page
                  </SwipeHint>
                </div>
                <div className="w-full max-w-[680px] flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-sm text-white/75">
                  <FormatBadge format={current.format} name={current.fileName} />
                  <span className="min-w-0 truncate font-mono text-[12.5px]">{current.fileName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[12.5px] whitespace-nowrap">
                    {unitWord(current)} {current.page} of {current.pageCount}
                  </span>
                </div>
                <div className="w-full max-w-[680px] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label={`Previous free ${unitWord(current).toLowerCase()}`}
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
                      aria-label={`Next free ${unitWord(current).toLowerCase()}`}
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
