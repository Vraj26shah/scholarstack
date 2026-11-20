import { type AdminCourseDto, type AdminUnitDto, PREVIEW_LIMITS, type PreviewPick } from '@ss/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ScrambledPage } from '../../shared/ui/scrambled-page';
import { plural } from './ui';

const PAGE_STRIP = 8;
const { files: MAX_FILES, pagesPerFile: MAX_PER_FILE, pages: MAX_PAGES } = PREVIEW_LIMITS;

const samePicks = (a: PreviewPick[], b: PreviewPick[]) =>
  a.length === b.length &&
  a.every((p, i) => p.fileId === b[i]?.fileId && p.pages.join(',') === b[i]?.pages.join(','));

/**
 * One unit's free previews ("Peek inside"): look through any file of the unit, tick pages, and
 * pick from more than one file. Up to 5 pages a file, 4 files and 10 pages a unit, shown to
 * students in the order picked.
 */
export function UnitPreview({ c, unit }: { c: AdminCourseDto; unit: AdminUnitDto }) {
  const qc = useQueryClient();
  const ready = unit.files.filter((f) => f.status === 'ready' && f.pageCount > 0 && !f.hidden);
  const current = unit.preview ?? { fileId: null, pages: [1], chosen: false };
  const saved: PreviewPick[] =
    current.files ?? (current.fileId ? [{ fileId: current.fileId, pages: current.pages }] : []);
  const [picks, setPicks] = useState<PreviewPick[]>(saved);
  const [fileId, setFileId] = useState(saved[0]?.fileId ?? ready[0]?.id ?? '');
  const [from, setFrom] = useState(1);
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState<string | null>(null);
  const savedKey = saved.map((p) => `${p.fileId}:${p.pages.join(',')}`).join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the saved choice changes
  useEffect(() => {
    setPicks(saved);
    setFileId(saved[0]?.fileId ?? ready[0]?.id ?? '');
  }, [savedKey]);
  const file = ready.find((f) => f.id === fileId);
  const nameOf = (id: string) => ready.find((f) => f.id === id)?.name ?? 'a file';
  const save = useMutation({
    mutationFn: (previews: PreviewPick[]) => api.adminSetUnitPreview(c.id, unit.key, previews),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-units', c.id] });
      void qc.invalidateQueries({ queryKey: ['course'] });
    },
  });
  const total = picks.reduce((n, p) => n + p.pages.length, 0);
  const ticked = picks.find((p) => p.fileId === fileId)?.pages ?? [];

  function toggle(n: number) {
    setLimit(null);
    const mine = picks.find((p) => p.fileId === fileId);
    if (mine?.pages.includes(n)) {
      const pages = mine.pages.filter((x) => x !== n);
      setPicks(
        pages.length ? picks.map((p) => (p === mine ? { ...p, pages } : p)) : picks.filter((p) => p !== mine),
      );
      return;
    }
    if (total >= MAX_PAGES) return setLimit(`That's ${MAX_PAGES} pages already. Untick one to add another.`);
    if (mine && mine.pages.length >= MAX_PER_FILE)
      return setLimit(`Up to ${MAX_PER_FILE} pages from one file. Pick from another file for more.`);
    if (!mine && picks.length >= MAX_FILES)
      return setLimit(`Up to ${MAX_FILES} files per unit. Remove one to use this file.`);
    setPicks(
      mine
        ? picks.map((p) => (p === mine ? { ...p, pages: [...p.pages, n].sort((a, b) => a - b) } : p))
        : [...picks, { fileId, pages: [n] }],
    );
  }

  /** Show a picked file's strip, starting at its first ticked page. */
  function look(p: PreviewPick) {
    setFileId(p.fileId);
    setFrom(Math.floor(((p.pages[0] ?? 1) - 1) / PAGE_STRIP) * PAGE_STRIP + 1);
    setLimit(null);
  }

  const changed = !samePicks(picks, saved);
  const savedPages = saved.reduce((n, p) => n + p.pages.length, 0);
  const summary = saved.length
    ? `${plural(savedPages, 'page')}${saved.length > 1 ? ` from ${saved.length} files` : ` of ${nameOf(saved[0]!.fileId)}`}`
    : 'nothing yet';

  return (
    <section
      className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-3"
      aria-label={`Free preview for ${unit.label}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-brand text-white">
          {unit.label}
        </span>
        <strong className="mr-auto">{unit.title}</strong>
        <span className="text-[13px] text-ink2">
          Students see {summary}
          {current.chosen ? ' (your choice)' : ' (default)'}
        </span>
        {!unit.hidden && ready.length > 0 && (
          <Button size="sm" variant={editing ? 'ghost' : 'outline'} onClick={() => setEditing(!editing)}>
            {editing ? 'Close' : 'Change'}
          </Button>
        )}
      </div>
      {unit.hidden ? (
        <p className="m-0 text-sm text-ink2">This unit is hidden, so it has no free preview.</p>
      ) : ready.length === 0 ? (
        <p className="m-0 text-sm text-ink2">
          No file in this unit has pages yet. Make its pages in the Files tab first.
        </p>
      ) : !editing ? null : (
        <>
          {/* What students will see, in order: one chip per file, with its pages. */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold">
              Picked · {total} of {MAX_PAGES} pages
              {ready.length > 1 ? `, ${picks.length} of ${Math.min(MAX_FILES, ready.length)} files` : ''}
            </span>
            {picks.length === 0 ? (
              <span className="text-[13px] text-ink2">
                Nothing ticked yet: students get page 1 of the first file.
              </span>
            ) : (
              <ol aria-label="Picked previews" className="m-0 p-0 list-none flex flex-wrap gap-1.5">
                {picks.map((p, i) => (
                  <li
                    key={p.fileId}
                    className={`inline-flex items-center h-8 pl-1 pr-0.5 rounded-full border-[1.5px] text-[13px] ${
                      p.fileId === fileId ? 'border-teal bg-teal/5' : 'border-line'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => look(p)}
                      className="inline-flex items-center gap-1.5 bg-transparent border-0 px-1 cursor-pointer text-ink min-w-0 max-w-[260px]"
                    >
                      <span className="flex-none grid place-items-center w-5 h-5 rounded-full bg-ink text-bg text-[11px] font-bold">
                        {i + 1}
                      </span>
                      <span className="truncate">{nameOf(p.fileId)}</span>
                      <span className="flex-none font-mono text-[12px] text-ink2">
                        p.{p.pages.join(', ')}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${nameOf(p.fileId)}`}
                      onClick={() => setPicks(picks.filter((x) => x !== p))}
                      className="grid place-items-center w-7 h-7 rounded-full bg-transparent border-0 cursor-pointer text-[16px] text-ink2 hover:bg-sunk hover:text-ink"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <label className="flex flex-col gap-1 text-[13px] font-semibold">
            Look through
            <select
              className="h-10 px-3 rounded-xl bg-surface border-[1.5px] border-line text-[14px] font-normal"
              value={fileId}
              onChange={(e) => {
                setFileId(e.target.value);
                setFrom(1);
                setLimit(null);
              }}
            >
              {ready.map((f) => {
                const n = picks.find((p) => p.fileId === f.id)?.pages.length ?? 0;
                return (
                  <option key={f.id} value={f.id}>
                    {f.name} · {plural(f.pageCount, 'page')}
                    {n ? ` · ${n} ticked` : ''}
                  </option>
                );
              })}
            </select>
          </label>
          {file && (
            <>
              <p className="m-0 text-[13px] text-ink2">
                Tick pages students can read free ({ticked.length} of {MAX_PER_FILE} from this file). Pages{' '}
                {from}–{Math.min(file.pageCount, from + PAGE_STRIP - 1)} of {file.pageCount}:
              </p>
              <ul className="m-0 p-0 list-none grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {Array.from(
                  { length: Math.min(PAGE_STRIP, file.pageCount - from + 1) },
                  (_, i) => from + i,
                ).map((n) => {
                  const on = ticked.includes(n);
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        aria-pressed={on}
                        aria-label={`${on ? 'Untick' : 'Tick'} page ${n}`}
                        onClick={() => toggle(n)}
                        className={`relative block w-full p-0 rounded-lg overflow-hidden border-2 cursor-pointer bg-white ${
                          on ? 'border-teal shadow-[0_0_0_3px_rgba(25,149,173,0.25)]' : 'border-line'
                        }`}
                      >
                        <ScrambledPage
                          fileId={file.id}
                          page={n}
                          admin
                          stamp=""
                          className="aspect-[1/1.414]"
                        />
                        <span
                          className={`absolute left-1.5 top-1.5 min-w-6 h-6 px-1.5 rounded-full text-[11px] font-bold inline-flex items-center justify-center ${
                            on ? 'bg-teal text-white' : 'bg-white/90 text-ink'
                          }`}
                        >
                          {on ? `✓ ${n}` : n}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {limit && (
                <p role="status" className="m-0 text-sm text-marigold-text">
                  {limit}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={from === 1}
                  onClick={() => setFrom(Math.max(1, from - PAGE_STRIP))}
                >
                  ← Earlier pages
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={from + PAGE_STRIP > file.pageCount}
                  onClick={() => setFrom(from + PAGE_STRIP)}
                >
                  Later pages →
                </Button>
                <span className="ml-auto flex gap-2">
                  {current.chosen && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={save.isPending}
                      onClick={() => save.mutate([])}
                    >
                      Use the default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!changed || picks.length === 0 || save.isPending}
                    onClick={() => save.mutate(picks)}
                  >
                    {save.isPending ? 'Saving…' : 'Save preview'}
                  </Button>
                </span>
              </div>
            </>
          )}
        </>
      )}
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
      {save.isSuccess && !changed && (
        <p className="m-0 text-sm text-teal-text" role="status">
          Saved. Students see it now.
        </p>
      )}
    </section>
  );
}
