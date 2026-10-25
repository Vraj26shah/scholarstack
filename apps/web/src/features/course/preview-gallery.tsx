import * as Dialog from '@radix-ui/react-dialog';
import type { CourseUnitDto } from '@ss/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../shared/ui/button';
import { ChevronLeft, ChevronRight, Cross, Eye } from '../../shared/ui/icons';
import { PagePreview } from '../../shared/ui/page-image';

interface Peek {
  unit: CourseUnitDto;
  fileId: string;
  fileName: string;
}

export function peeksOf(units: CourseUnitDto[]): Peek[] {
  return units.flatMap((u) => {
    if (!u.previewFileId) return [];
    const file = u.files.find((f) => f.id === u.previewFileId);
    return [{ unit: u, fileId: u.previewFileId, fileName: file?.name ?? '' }];
  });
}

/**
 * "Peek inside": the first page of every unit, before you buy. Thumbnails sit in a row; tapping one opens a large view you can flip through unit by unit.
 */
export function PreviewGallery({
  units,
  owned,
  onBuy,
  buyLabel,
}: {
  units: CourseUnitDto[];
  owned: boolean;
  onBuy?: () => void;
  buyLabel?: string;
}) {
  const peeks = peeksOf(units);
  const [open, setOpen] = useState<number | null>(null);

  const step = useCallback(
    (d: number) => setOpen((i) => (i === null ? i : (i + d + peeks.length) % peeks.length)),
    [peeks.length],
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
    <section aria-labelledby="peek-title" className="mt-14">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
        <h2
          id="peek-title"
          className="m-0 font-display font-extrabold text-[clamp(32px,4vw,44px)] tracking-[-0.045em] leading-none"
        >
          Peek at page one
        </h2>
        <span className="text-sm text-ink2">
          The first page of every {peeks.length > 1 ? `unit · ${peeks.length} pages` : 'unit'}
        </span>
      </div>
      <ul className="list-none m-0 p-0 flex gap-5 overflow-x-auto pb-6 pt-2 px-1 snap-x">
        {peeks.map((p, i) => (
          <li key={p.fileId} className="deal-in snap-start flex-none" style={{ ['--i' as string]: i }}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`Preview page 1 of ${p.unit.label}: ${p.unit.title}`}
              className="group block w-[200px] sm:w-[220px] p-0 border-0 bg-transparent text-left cursor-zoom-in"
            >
              <span className="block relative rounded-lg overflow-hidden bg-white shadow-[0_18px_34px_-20px_var(--shadow),0_0_0_1px_var(--line)] lift">
                <PagePreview fileId={p.fileId} className="w-full aspect-[1/1.414]" />
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
                  Page 1 of {current.fileName}. Use the arrow keys to see other units.
                </Dialog.Description>
                <div className="relative w-full max-w-[680px] flex-1 min-h-0 flex items-center justify-center">
                  <PagePreview
                    key={current.fileId}
                    fileId={current.fileId}
                    crop="full"
                    eager
                    alt={`Page 1 of ${current.fileName}`}
                    className="pop-in h-full max-h-full aspect-[1/1.414] max-w-full rounded-lg bg-white shadow-2xl"
                  />
                </div>
                <div className="w-full max-w-[680px] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => step(-1)}
                      aria-label="Previous unit"
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
                      aria-label="Next unit"
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
