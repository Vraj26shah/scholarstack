import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useTheme } from '../../lib/theme';
import { Button } from '../../shared/ui/button';
import { Spinner } from '../../shared/ui/feedback';
import { Sheet } from '../../shared/ui/feedback';
import { ChevronLeft, ChevronRight, Shield, Sparkle } from '../../shared/ui/icons';
import { ThemeToggle } from '../../shared/ui/theme-toggle';
import { PageCanvas } from './page-canvas';
import { useReader } from './use-reader';

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

export function ReaderPage() {
  const { fileId = '' } = useParams();
  const r = useReader(fileId);
  const { theme } = useTheme();
  const [zoom, setZoom] = useState(1);
  const [pageInput, setPageInput] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [readerNotice, setReaderNotice] = useState('');
  const pageStageRef = useRef<HTMLDivElement>(null);
  const pageCanvasRef = useRef<HTMLCanvasElement>(null);
  const { veiled, lift } = useVeil();
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

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === pageStageRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    const stage = pageStageRef.current;
    if (!stage) return;
    if (document.fullscreenElement === stage) {
      await document.exitFullscreen();
      return;
    }
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      return;
    }
    try {
      if (stage.requestFullscreen) {
        await stage.requestFullscreen();
        return;
      }
    } catch {
      // CSS full-screen mode below also works on browsers without the Fullscreen API.
    }
    setFallbackFullscreen(true);
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
        error instanceof Error ? error.message : 'Could not share this page. Please try again.',
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
          <Link to="/shelf" className="text-teal-text self-center">
            Back to shelf
          </Link>
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
  const files = course.data?.units ?? [];

  return (
    <div className="min-h-dvh bg-bg text-ink no-select">
      <header className="sticky top-0 z-20 bg-bg/95 backdrop-blur px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-3 border-b border-line">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Link
            to="/shelf"
            aria-label="Back to my shelf"
            className="flex-none inline-flex items-center gap-1.5 h-11 px-3 sm:pl-2.5 sm:pr-4 rounded-full bg-surface border border-line text-ink no-underline text-sm font-medium whitespace-nowrap"
          >
            <ChevronLeft size={18} /> <span className="hidden sm:inline">My shelf</span>
          </Link>
          <div className="min-w-0">
            <div className="font-display font-extrabold text-[20px] sm:text-[22px] tracking-[-0.035em] leading-tight truncate">
              {s.fileName}
            </div>
            <div className="font-mono text-xs text-ink2 truncate">
              {s.courseTitle} / {s.unitLabel}
            </div>
          </div>
        </div>
        <div className="flex-none flex items-center gap-2.5">
          <span className="hidden md:inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-blush text-blush-text text-[13px] font-semibold">
            <Shield size={15} /> Protected · your name is on every page
          </span>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-wrap">
        <aside
          aria-label="Course contents"
          className="flex-[1_1_280px] min-w-0 p-3 sm:p-5 order-2 lg:order-1 border-t lg:border-t-0 border-line"
        >
          <div className="font-mono text-xs tracking-[0.14em] text-ink2 px-1.5 pb-3">IN THIS CARD</div>
          <nav className="flex flex-col gap-1.5">
            {files.map((u) => {
              const here = u.files.some((f) => f.id === fileId);
              return (
                <div key={u.key} className={here ? 'rounded-[18px] bg-brand text-white p-3' : ''}>
                  <div className={`flex items-center gap-3 ${here ? 'pb-2' : 'px-3 min-h-11'}`}>
                    <span
                      className={`font-mono text-[11px] font-semibold px-2 py-1 rounded-md ${
                        here ? 'bg-mist text-on-mist' : 'bg-surface border border-line'
                      }`}
                    >
                      {u.label.replace('UNIT ', 'U')}
                    </span>
                    <span className={`text-[15px] ${here ? 'font-semibold' : ''}`}>{u.title}</span>
                  </div>
                  {here &&
                    u.files.map((f) =>
                      f.id === fileId ? (
                        <div
                          key={f.id}
                          aria-current="page"
                          className="flex flex-col gap-2 p-3 rounded-xl bg-white/12"
                        >
                          <span className="text-sm font-semibold break-all">{f.name}</span>
                          <span className="flex items-center gap-2">
                            <span className="flex-1 h-[5px] rounded-full bg-white/20 overflow-hidden">
                              <span
                                className="block h-[5px] bg-mist"
                                style={{ width: `${(r.page / s.pageCount) * 100}%` }}
                              />
                            </span>
                            <span className="font-mono text-xs">
                              {r.page}/{s.pageCount}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <Link
                          key={f.id}
                          to={`/read/${f.id}`}
                          className="flex items-center min-h-11 px-3 rounded-xl text-on-brand2 no-underline text-sm break-all"
                        >
                          {f.name}
                        </Link>
                      ),
                    )}
                </div>
              );
            })}
          </nav>
        </aside>

        <main className="flex-[999_1_560px] min-w-0 px-2 sm:px-6 py-4 sm:py-8 flex flex-col items-center gap-4 sm:gap-5 order-1 lg:order-2 overflow-x-auto">
          <div
            ref={pageStageRef}
            className={`reader-page-stage relative w-full flex justify-center bg-bg ${fallbackFullscreen ? 'reader-page-stage-fallback-fullscreen' : ''}`}
          >
            {r.current ? (
              <PageCanvas
                bitmap={r.current.bitmap}
                seed={r.current.seed}
                watermark={s.watermark}
                night={theme === 'dark'}
                zoom={zoom}
                canvasRef={pageCanvasRef}
              />
            ) : (
              <div className="w-full max-w-[660px] aspect-[1/1.414] skeleton" />
            )}
            {r.loadingPage && r.current && (
              <div className="absolute top-3 right-3">
                <Spinner size={28} label="Loading page" />
              </div>
            )}
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              disabled={!r.current || !!r.problem}
              aria-label={
                fullscreen || fallbackFullscreen ? 'Exit full screen' : 'View this page full screen'
              }
              className="absolute top-2 right-2 z-10 min-h-10 rounded-full border border-line bg-surface/95 px-3 text-xs font-semibold text-ink shadow-md disabled:opacity-50"
            >
              {fullscreen || fallbackFullscreen ? 'Exit full screen' : 'Full screen'}
            </button>
            {(veiled || r.problem) && (
              <div className="absolute inset-0 backdrop-blur-xl bg-bg/60 flex flex-col items-center justify-center gap-4 text-center p-6 rounded-md">
                {r.problem === 'lease-taken' ? (
                  <>
                    <p className="m-0 font-display font-extrabold text-3xl tracking-[-0.03em]">
                      Reading somewhere else?
                    </p>
                    <p className="m-0 text-ink2 max-w-sm">
                      This file was opened in another tab or on another device. Only one reader can be open at
                      a time.
                    </p>
                    <Button variant="mist" onClick={() => void r.reopen()}>
                      Read here instead
                    </Button>
                  </>
                ) : r.problem ? (
                  <>
                    <p className="m-0 font-display font-extrabold text-3xl tracking-[-0.03em]">Paused.</p>
                    <p className="m-0 text-ink2 max-w-sm">{r.message}</p>
                    <Button variant="outline" onClick={() => void r.reopen()}>
                      Try again
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="m-0 font-display font-extrabold text-3xl tracking-[-0.03em]">
                      Paused while you were away.
                    </p>
                    <Button variant="mist" onClick={lift}>
                      Continue reading
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="w-full max-w-[660px] flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
            <div className="flex flex-wrap items-center justify-center gap-1 p-1 rounded-[20px] sm:rounded-full bg-brand text-white shadow-[0_14px_30px_-18px_var(--shadow)] sm:flex-1">
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
                onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}
                className="w-11 h-11 rounded-full border-0 bg-transparent text-white text-xl cursor-pointer"
              >
                −
              </button>
              <span className="font-mono text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(2, +(z + 0.2).toFixed(1)))}
                className="w-11 h-11 rounded-full border-0 bg-transparent text-white text-xl cursor-pointer"
              >
                +
              </button>
            </div>
            <Button
              variant="outline"
              className="w-full sm:w-auto shrink-0"
              onClick={() => {
                setShareMessage('');
                setShareOpen(true);
              }}
              disabled={!r.current || r.loadingPage || !!r.problem || veiled || shareBusy}
            >
              <Sparkle size={18} /> Ask AI about this page
            </Button>
          </div>
          <p className="m-0 text-[13px] text-ink2 text-center">
            Your name is on every page. No downloads, no printing.
          </p>
          {readerNotice && (
            <p role="status" className="m-0 text-sm text-blush-text text-center">
              {readerNotice}
            </p>
          )}
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
              <p role="status" className="m-0 rounded-xl bg-sunk px-3 py-2 text-sm text-ink2">
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
              <Sparkle size={18} /> {shareBusy ? 'Preparing page…' : 'Choose an AI app'}
            </Button>
          </Sheet>
        </main>
      </div>
    </div>
  );
}
