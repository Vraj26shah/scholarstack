import type { CourseUnitDto } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { useBack } from '../../shared/ui/back-link';
import { Button } from '../../shared/ui/button';
import { Spinner } from '../../shared/ui/feedback';
import { Sheet } from '../../shared/ui/feedback';
import { AskBubble, ChevronDown, ChevronLeft, ChevronRight } from '../../shared/ui/icons';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { PageCanvas } from './page-canvas';
import { useReader } from './use-reader';
import { useZoom } from './use-zoom';

const IDLE_MS = 30 * 60 * 1000;

/** Blocks the usual save/print shortcuts while reading (deterrent only). */
function useReaderGuards(onPrev: () => void, onNext: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'p')) e.preventDefault();
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      )
        return;
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext]);
}

function useVeil() {
  const [veiled, setVeiled] = useState(false);
  useEffect(() => {
    let idle: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(idle);
      idle = setTimeout(() => setVeiled(true), IDLE_MS);
    };
    const onVis = () => document.visibilityState === 'hidden' && setVeiled(true);
    const onBlur = () => setVeiled(true);
    reset();
    window.addEventListener('pointermove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearTimeout(idle);
      window.removeEventListener('pointermove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return { veiled, lift: () => setVeiled(false) };
}

/** Every file gets a fresh reader, so switching files never inherits the last file's state. */
export function ReaderPage() {
  const { fileId = '' } = useParams();
  return <ReaderView key={fileId} fileId={fileId} />;
}

/** Course contents: every unit opens, every file is one tap away. */
function Contents({
  units,
  fileId,
  page,
  pageCount,
  openAll = false,
  onPick,
}: {
  units: CourseUnitDto[];
  fileId: string;
  page: number;
  pageCount: number;
  openAll?: boolean;
  onPick?: () => void;
}) {
  const currentUnit = units.find((u) => u.files.some((f) => f.id === fileId))?.key;
  const [open, setOpen] = useState<Set<string>>(() =>
    openAll ? new Set(units.map((u) => u.key)) : new Set(currentUnit ? [currentUnit] : []),
  );
  useEffect(() => {
    if (currentUnit) setOpen((s) => new Set(s).add(currentUnit));
  }, [currentUnit]);
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  if (!units.length) return <div className="skeleton h-40" />;
  return (
    <nav aria-label="Units and files" className="flex flex-col gap-1">
      {units.map((u) => {
        const here = u.key === currentUnit;
        const expanded = open.has(u.key);
        return (
          <div key={u.key} className={`rounded-2xl transition-colors ${here ? 'bg-brand text-white' : ''}`}>
            <button
              type="button"
              onClick={() => toggle(u.key)}
              aria-expanded={expanded}
              className={`w-full flex items-center gap-3 px-3 min-h-12 rounded-2xl text-left ${
                here ? '' : 'hover:bg-sunk'
              }`}
            >
              <span
                className={`flex-none font-mono text-[11px] font-semibold px-2 py-1 rounded-md ${
                  here ? 'bg-mist text-on-mist' : 'bg-surface border border-line'
                }`}
              >
                {u.label.replace('UNIT ', 'U')}
              </span>
              <span className={`flex-1 min-w-0 text-[15px] ${here ? 'font-semibold' : ''}`}>{u.title}</span>
              <span className={`flex-none text-xs ${here ? 'text-on-brand2' : 'text-ink2'}`}>
                {u.files.length}
              </span>
              <ChevronDown
                size={16}
                className={`flex-none transition-transform duration-300 ${expanded ? '' : '-rotate-90'} ${
                  here ? 'text-on-brand2' : 'text-ink2'
                }`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(.22,1,.36,1)] ${
                expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <ul
                className="m-0 list-none overflow-hidden p-0 min-h-0"
                inert={!expanded}
                aria-hidden={!expanded}
              >
                <div className={`flex flex-col gap-1 ${here ? 'px-2 pb-2' : 'pl-11 pr-1 pb-1.5'}`}>
                  {u.files.map((f) =>
                    f.id === fileId ? (
                      <li
                        key={f.id}
                        aria-current="page"
                        className="flex flex-col gap-2 p-3 rounded-xl bg-white/12"
                      >
                        <span className="text-sm font-semibold break-words">{f.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="flex-1 h-[5px] rounded-full bg-white/20 overflow-hidden">
                            <span
                              className="block h-[5px] bg-mist transition-[width] duration-500"
                              style={{ width: `${(page / pageCount) * 100}%` }}
                            />
                          </span>
                          <span className="font-mono text-xs">
                            {page}/{pageCount}
                          </span>
                        </span>
                      </li>
                    ) : (
                      <li key={f.id}>
                        <Link
                          to={`/read/${f.id}`}
                          onClick={onPick}
                          className={`flex items-center justify-between gap-3 min-h-11 px-3 rounded-xl no-underline text-sm break-words ${
                            here ? 'text-on-brand2 hover:bg-white/10' : 'text-ink hover:bg-sunk'
                          }`}
                        >
                          <span className="min-w-0">{f.name}</span>
                          <span className={`flex-none text-xs ${here ? 'text-on-brand2' : 'text-ink2'}`}>
                            {f.pageCount} pp
                          </span>
                        </Link>
                      </li>
                    ),
                  )}
                </div>
              </ul>
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Pages that are part of opening or paying for a file: Back skips past them. */
const notABackStop = (path: string) =>
  path.startsWith('/read/') ||
  path.startsWith('/checkout') ||
  path.startsWith('/sign-in') ||
  path.startsWith('/auth/');

function ReaderView({ fileId }: { fileId: string }) {
  const r = useReader(fileId);
  // Back returns to where the student came from (course, bundle, shelf, catalogue), skipping
  // the other files they flipped through; opened from a link, it goes to this file's course.
  const back = useBack(r.session ? `/c/${r.session.courseId}` : '/shelf', notABackStop);
  const { theme } = useTheme();
  const [pageInput, setPageInput] = useState('');
  // Switching files while in full screen keeps you in full screen.
  const [immersive, setImmersive] = useState(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  );
  const [contentsOpen, setContentsOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(660);
  const { zoom, zoomTo, reset } = useZoom(scrollerRef, {
    min: immersive ? 0.5 : 0.6,
    max: immersive ? 4 : 2.4,
    immersive,
  });
  const [shareOpen, setShareOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [readerNotice, setReaderNotice] = useState('');
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const { veiled, lift } = useVeil();
  // Page turns slide in from the side you are moving toward.
  const lastPage = useRef(r.page);
  const direction = useRef(1);
  const [turn, setTurn] = useState({ n: 0, dir: 1 });
  useEffect(() => {
    direction.current = r.page >= lastPage.current ? 1 : -1;
    lastPage.current = r.page;
  }, [r.page]);
  useEffect(() => {
    if (r.current) setTurn((t) => ({ n: t.n + 1, dir: direction.current }));
  }, [r.current]);
  const turnClass = turn.n > 1 ? (turn.dir > 0 ? 'page-turn-next' : 'page-turn-prev') : '';
  const course = useQuery({
    queryKey: ['course', r.session?.courseId],
    queryFn: () => api.course(r.session!.courseId),
    enabled: !!r.session,
  });
  useReaderGuards(
    () => r.go(r.page - 1),
    () => r.go(r.page + 1),
  );

  useEffect(() => setPageInput(String(r.page)), [r.page]);

  // Full screen covers the whole document, so the toolbar and the AI sheet still work in it.
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  useEffect(() => {
    if (!immersive) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Escape') setImmersive(false);
      if (e.key === '+' || e.key === '=') zoomTo((z) => z * 1.2);
      if (e.key === '-') zoomTo((z) => z / 1.2);
      if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [immersive, zoomTo, reset]);
  // In full screen the page first fits the screen; zoom multiplies that.
  const hasSession = !!r.session;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page area mounts once the session opens; re-measure then.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () =>
      setFit(
        immersive
          ? Math.max(280, Math.min(el.clientWidth - 48, (el.clientHeight - 140) / Math.SQRT2))
          : Math.min(660, el.clientWidth),
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [immersive, hasSession]);

  async function toggleFullscreen() {
    if (immersive) {
      setImmersive(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      return;
    }
    reset();
    setImmersive(true);
    try {
      await document.documentElement.requestFullscreen?.();
    } catch {
      // Browsers without the Fullscreen API still get the full-window reading view.
    }
  }

  async function sharePageWithAi() {
    const canvas = pageCanvasRef.current;
    if (!canvas) return;
    setShareBusy(true);
    setShareMessage('');
    try {
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error('Could not prepare this page.'))),
          'image/png',
        ),
      );
      const file = new File([blob], `scholars-stack-page-${r.page}.png`, { type: 'image/png' });
      const prompt = `I am studying ${s.fileName}, page ${r.page} of ${s.pageCount} (${s.courseTitle}, ${s.unitLabel}). ${question.trim() || 'Please explain the key ideas on this page in simple terms.'}`;
      const copyImage = async () => {
        if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        setShareMessage('Page image copied. Paste it into your AI chat, then ask your question.');
        return true;
      };
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `${s.fileName} · page ${r.page}`,
            text: prompt,
          });
          setShareOpen(false);
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return;
          if (!(await copyImage())) throw error;
        }
      } else if (!(await copyImage())) {
        setShareMessage(
          'Image sharing is not supported here. Use a secure browser or your device’s share menu.',
        );
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      setShareMessage(
        'Could not share this page. Please try again.',
      );
    } finally {
      setShareBusy(false);
    }
  }

  if (r.problem && !r.session)
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="m-0 font-display font-extrabold text-3xl tracking-[-0.03em]">
          This file can't open right now.
        </p>
        <p className="m-0 text-ink2 max-w-md">{r.message}</p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => void r.reopen()}>
            Try again
          </Button>
          <button
            type="button"
            onClick={back.go}
            className="text-teal-text self-center bg-transparent border-0 cursor-pointer p-0 text-base"
          >
            {back.label}
          </button>
        </div>
      </div>
    );

  if (!r.session)
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Spinner label="Opening the reader" />
      </div>
    );

  const s = r.session;
  const units = course.data?.units ?? [];
  const allFiles = units.flatMap((u) => u.files.map((f) => ({ ...f, unitTitle: u.title })));
  const here = allFiles.findIndex((f) => f.id === fileId);
  const nextFile = here >= 0 ? allFiles[here + 1] : undefined;
  const atEnd = r.page >= s.pageCount;
  const width = fit * zoom;
  const blocked = !r.current || !!r.problem;
  const openAi = () => {
    setShareMessage('');
    setShareOpen(true);
  };

  const overlay = (veiled || r.problem) && (
    <div className="absolute inset-0 z-10 backdrop-blur-xl bg-bg/60 flex flex-col items-center justify-center gap-4 text-center p-6 rounded-md">
      {r.problem === 'lease-taken' ? (
        <>
          <p className="m-0 font-display font-extrabold text-3xl">Reading somewhere else?</p>
          <p className="m-0 text-ink2 max-w-sm">
            This file was opened in another tab or on another device. Only one reader can be open at a time.
          </p>
          <Button variant="mist" onClick={() => void r.reopen()}>
            Read here instead
          </Button>
        </>
      ) : r.problem ? (
        <>
          <p className="m-0 font-display font-extrabold text-3xl">Paused.</p>
          <p className="m-0 text-ink2 max-w-sm">{r.message}</p>
          <Button variant="outline" onClick={() => void r.reopen()}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <p className="m-0 font-display font-extrabold text-3xl">Paused while you were away.</p>
          <Button variant="mist" onClick={lift}>
            Continue reading
          </Button>
        </>
      )}
    </div>
  );

  const toolbar = (
    <div
      className={`flex flex-wrap items-center justify-center gap-1 p-1 rounded-[20px] sm:rounded-full bg-brand text-white shadow-[0_14px_30px_-18px_var(--shadow)] ${
        immersive ? 'shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]' : 'lg:flex-1 lg:flex-nowrap'
      }`}
    >
      <button
        type="button"
        onClick={() => setContentsOpen(true)}
        aria-label="All modules and files"
        title="All modules and files"
        className="inline-flex items-center gap-2 h-11 px-3.5 rounded-full border-0 bg-white/12 hover:bg-white/20 text-white text-sm font-semibold cursor-pointer"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
        </svg>
        <span className="hidden sm:inline">Contents</span>
      </button>
      <span aria-hidden="true" className="w-px h-6 bg-white/30 mx-1 hidden min-[420px]:block" />
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => r.go(r.page - 1)}
        disabled={r.page <= 1}
        className="w-11 h-11 rounded-full border-0 bg-transparent text-white inline-flex items-center justify-center cursor-pointer disabled:opacity-40"
      >
        <ChevronLeft size={18} />
      </button>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          r.go(Number(pageInput) || r.page);
        }}
        className="flex items-center gap-1.5 font-mono text-sm px-1"
      >
        <label htmlFor="page-no" className="sr-only">
          Page number
        </label>
        <input
          id="page-no"
          inputMode="numeric"
          value={pageInput}
          onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
          className="w-11 h-9 rounded-lg border-0 bg-white/15 text-white text-center font-mono"
        />
        <span>/ {s.pageCount}</span>
      </form>
      <button
        type="button"
        aria-label="Next page"
        onClick={() => r.go(r.page + 1)}
        disabled={r.page >= s.pageCount}
        className="w-11 h-11 rounded-full border-0 bg-mist text-on-mist inline-flex items-center justify-center cursor-pointer disabled:opacity-40"
      >
        <ChevronRight size={18} />
      </button>
      <span aria-hidden="true" className="w-px h-6 bg-white/30 mx-1.5 hidden min-[390px]:block" />
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => zoomTo((z) => z / 1.2)}
        className="w-11 h-11 rounded-full border-0 bg-transparent text-white text-xl cursor-pointer"
      >
        −
      </button>
      <button
        type="button"
        aria-label="Reset zoom"
        title="Reset zoom"
        onClick={reset}
        className={`${immersive ? '' : 'hidden min-[420px]:block'} font-mono text-sm w-14 h-9 rounded-lg bg-transparent hover:bg-white/10 text-white border-0 cursor-pointer`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => zoomTo((z) => z * 1.2)}
        className="w-11 h-11 rounded-full border-0 bg-transparent text-white text-xl cursor-pointer"
      >
        +
      </button>
      {immersive && (
        <>
          <span aria-hidden="true" className="w-px h-6 bg-white/30 mx-1.5" />
          {atEnd && nextFile && (
            <Link
              to={`/read/${nextFile.id}`}
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-full bg-marigold text-on-marigold text-sm font-semibold no-underline"
            >
              Next file <ChevronRight size={16} />
            </Link>
          )}
          <button
            type="button"
            onClick={openAi}
            disabled={blocked || r.loadingPage || veiled || shareBusy}
            className="inline-flex items-center gap-2 h-11 px-4 rounded-full border-0 bg-white/12 hover:bg-white/20 text-white text-sm font-semibold cursor-pointer disabled:opacity-40"
          >
            <AskBubble size={16} /> Ask AI
          </button>
          <button
            type="button"
            aria-label="Exit full screen"
            onClick={() => void toggleFullscreen()}
            className="inline-flex items-center h-11 px-4 rounded-full border-0 bg-mist text-on-mist text-sm font-semibold cursor-pointer"
          >
            Done
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="min-h-dvh bg-bg text-ink no-select">
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-3 border-b border-line">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={back.go}
            aria-label={back.label}
            title={back.label}
            className="flex-none inline-flex items-center gap-1.5 h-11 px-3 sm:pl-2.5 sm:pr-4 rounded-full bg-surface border border-line text-ink text-sm font-medium whitespace-nowrap cursor-pointer"
          >
            <ChevronLeft size={18} /> <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[20px] sm:text-[22px] leading-tight truncate">
              {s.fileName}
            </div>
            <div className="text-xs text-ink2 truncate">
              {s.courseTitle} · {s.unitLabel.replace('UNIT', 'Unit')}
            </div>
          </div>
        </div>
        <div className="flex-none flex items-center gap-2.5">
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-wrap">
        <aside
          aria-label="Course contents"
          className="flex-[1_1_280px] lg:max-w-[340px] min-w-0 p-3 sm:p-5 order-2 lg:order-1 border-t lg:border-t-0 border-line lg:sticky lg:top-[72px] lg:self-start lg:max-h-[calc(100dvh-72px)] lg:overflow-y-auto"
        >
          <div className="text-[13px] font-semibold text-ink2 px-1.5 pb-3">In this card</div>
          <Contents units={units} fileId={fileId} page={r.page} pageCount={s.pageCount} />
        </aside>

        <main className="flex-[999_1_560px] min-w-0 px-2 sm:px-6 py-4 sm:py-8 flex flex-col items-center gap-4 sm:gap-5 order-1 lg:order-2 overflow-x-auto">
          <div
            ref={immersive ? undefined : scrollerRef}
            className={immersive ? 'fixed inset-0 z-30 bg-bg' : 'relative w-full flex justify-center bg-bg'}
          >
            {immersive ? (
              <div
                ref={scrollerRef}
                className="reader-immersive absolute inset-0 overflow-auto"
                style={{ touchAction: 'none' }}
              >
                <div className="min-w-full min-h-full w-max flex items-center justify-center px-6 pt-6 pb-32">
                  <div className="relative">
                    {r.current ? (
                      <div key={turn.n} className={turnClass}>
                        <PageCanvas
                          bitmap={r.current.bitmap}
                          ordered={r.current.ordered}
                          seed={r.current.seed}
                          watermark={s.watermark}
                          night={theme === 'dark'}
                          width={width}
                          canvasRef={pageCanvasRef}
                        />
                      </div>
                    ) : (
                      <div className="aspect-[1/1.414] skeleton" style={{ width }} />
                    )}
                    {overlay}
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative max-w-full">
                {r.current ? (
                  <div key={turn.n} className={turnClass}>
                    <PageCanvas
                      bitmap={r.current.bitmap}
                      ordered={r.current.ordered}
                      seed={r.current.seed}
                      watermark={s.watermark}
                      night={theme === 'dark'}
                      width={width}
                      canvasRef={pageCanvasRef}
                    />
                  </div>
                ) : (
                  <div className="w-[min(660px,92vw)] aspect-[1/1.414] skeleton" />
                )}
                {overlay}
              </div>
            )}
            {r.loadingPage && r.current && (
              <div className={`${immersive ? 'fixed' : 'absolute'} top-4 left-4 z-40`}>
                <Spinner size={28} label="Loading page" />
              </div>
            )}
            {!immersive && (
              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                disabled={blocked}
                aria-label="View this page full screen"
                className="absolute top-2 right-2 z-10 min-h-10 rounded-full border border-line bg-surface/95 px-3 text-xs font-semibold text-ink shadow-md disabled:opacity-50"
              >
                Full screen
              </button>
            )}
            {immersive && (
              <>
                <div className="fixed top-4 inset-x-0 z-40 flex justify-center pointer-events-none">
                  <span className="rounded-full bg-surface/90 backdrop-blur px-4 py-2 text-xs text-ink2 shadow-sm">
                    Scroll or pinch to zoom · drag to move · double-click to zoom in · Esc to leave
                  </span>
                </div>
                <div className="fixed bottom-5 inset-x-0 z-40 flex justify-center px-3 pointer-events-none">
                  <div className="pointer-events-auto">{toolbar}</div>
                </div>
              </>
            )}
          </div>

          {!immersive && (
            <div className="w-full max-w-[660px] flex flex-col lg:flex-row items-stretch lg:items-center justify-center gap-2.5">
              {toolbar}
              <Button
                variant="outline"
                className="w-full lg:w-auto shrink-0"
                onClick={openAi}
                aria-label="Ask AI about this page"
                disabled={blocked || r.loadingPage || veiled || shareBusy}
              >
                <AskBubble size={18} /> <span className="lg:hidden">Ask AI about this page</span>
                <span className="hidden lg:inline">Ask AI</span>
              </Button>
            </div>
          )}
          {!immersive && atEnd && nextFile && (
            <Link
              to={`/read/${nextFile.id}`}
              className="pop-in w-full max-w-[660px] flex items-center justify-between gap-4 rounded-2xl border-[1.5px] border-marigold bg-marigold-soft/60 px-5 py-4 no-underline text-ink"
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-marigold-text">
                  You finished this file · up next
                </span>
                <span className="block truncate font-semibold">{nextFile.name}</span>
                <span className="block text-xs text-ink2">{nextFile.unitTitle}</span>
              </span>
              <span className="inline-flex flex-none items-center gap-1 text-sm font-semibold">
                Open <ChevronRight size={16} />
              </span>
            </Link>
          )}
          <p className="m-0 text-[13px] text-ink2 text-center">
            Your name is on every page. No downloads, no printing. Ctrl + scroll to zoom.
          </p>
          {readerNotice && (
            <p role="status" className="m-0 text-sm text-blush-text text-center">
              {readerNotice}
            </p>
          )}
          <Sheet open={contentsOpen} onOpenChange={setContentsOpen} title="All modules and files">
            <p className="m-0 text-sm text-ink2">
              Open any file in this course. Your place in each file is saved.
            </p>
            <div className="max-h-[58vh] overflow-y-auto -mx-2 px-2">
              <Contents
                units={units}
                fileId={fileId}
                page={r.page}
                pageCount={s.pageCount}
                openAll
                onPick={() => setContentsOpen(false)}
              />
            </div>
          </Sheet>
          <Sheet open={shareOpen} onOpenChange={setShareOpen} title="Ask about this page">
            <p className="m-0 text-sm leading-relaxed text-ink2">
              Share the current watermarked page with an AI app from your device’s share menu. Your question
              and page details go with it. On desktop, the page image is copied so you can paste it into your
              preferred AI chat.
            </p>
            <label htmlFor="reader-ai-question" className="text-sm font-semibold">
              What are you unsure about?
            </label>
            <textarea
              id="reader-ai-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={1000}
              placeholder="Ask about a definition, formula, or example on this page…"
              className="min-h-28 w-full resize-y rounded-xl border-[1.5px] border-line bg-surface px-3 py-2.5 text-sm text-ink"
            />
            <p className="m-0 text-xs leading-relaxed text-ink2">
              Only this page is shared. It includes your reader watermark. Choose an AI provider you trust.
            </p>
            {shareMessage && (
              <p role="status" className="m-0 text-sm text-ink2">
                {shareMessage}
              </p>
            )}
            <Button
              variant="brand"
              size="lg"
              className="w-full"
              onClick={() => void sharePageWithAi()}
              disabled={shareBusy || r.loadingPage || !r.current || !!r.problem}
            >
              <AskBubble size={18} /> {shareBusy ? 'Preparing page…' : 'Choose an AI app'}
            </Button>
          </Sheet>
        </main>
      </div>
    </div>
  );
}
