import {
  PACK_LADDER_RUPEES,
  PACK_SIZES,
  type PackLadder,
  type PackPlanDto,
  type PackRunDto,
  isFestivePackName,
  ladderProblems,
  offerPackName,
} from '@ss/contracts';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney, formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { Field, input, plural } from './ui';

const ACTION: Record<PackPlanDto['action'], { label: string; style: string }> = {
  create: { label: 'New', style: 'bg-marigold text-on-marigold' },
  update: { label: 'Update', style: 'bg-marigold-soft text-marigold-text' },
  same: { label: 'Up to date', style: 'bg-mist text-on-mist' },
  retire: { label: 'Off sale', style: 'bg-blush text-blush-text' },
  skip: { label: 'No pack', style: 'bg-sunk text-ink2' },
};

const ALL_YEAR = 'Semester pack';
const NAMES = [ALL_YEAR, 'Drawer pack', 'Exam pack'];

/** The ladder as the boxes hold it (text, so a box can be empty while typing). */
type Draft = Record<string, string>;
const toDraft = (l: PackLadder): Draft =>
  Object.fromEntries(PACK_SIZES.map((n) => [String(n), String(l[String(n)] ?? '')]));
const fromDraft = (d: Draft): PackLadder =>
  Object.fromEntries(PACK_SIZES.map((n) => [String(n), Number(d[String(n)] || 0)]));
const sameLadder = (a: PackLadder, b: PackLadder) => PACK_SIZES.every((n) => a[String(n)] === b[String(n)]);

/**
 * Prices from a rule: ₹first a course for 2 courses, then ₹drop less a course for each bigger
 * size, each total rounded down to end in 9 (whole rupees under ₹20) and nudged so every bigger
 * pack still costs more in total and less per course.
 */
export function ladderFromRule(first: number, drop: number): PackLadder {
  const out: PackLadder = {};
  let prev: { n: number; r: number } | null = null;
  for (const n of PACK_SIZES) {
    const raw = Math.max(9, n * Math.max(1, first - drop * (n - 2)));
    let r = raw >= 20 ? Math.floor(raw) - ((Math.floor(raw) + 1) % 10) : Math.floor(raw);
    if (prev) {
      // Keep the shape: more in total than the last size, less per course.
      const maxForPerCourse = Math.ceil((prev.r * n) / prev.n) - 1;
      r = Math.min(r, maxForPerCourse);
      if (r <= prev.r) r = Math.min(maxForPerCourse, prev.r + 1);
    }
    out[String(n)] = r;
    prev = { n, r };
  }
  return out;
}

const linkButton = 'font-semibold text-teal-text underline bg-transparent border-0 p-0 cursor-pointer';

/** The price list: one box per pack size, its price per course, and what it saves. */
function LadderEditor({
  draft,
  onDraft,
  saved,
  avgPaise,
}: {
  draft: Draft;
  onDraft: (d: Draft) => void;
  saved: PackLadder;
  avgPaise: number | null;
}) {
  const ladder = fromDraft(draft);
  const problems = ladderProblems(ladder);
  const bad = new Map(problems.map((p) => [p.size, p.message]));
  const perCourse = PACK_SIZES.map((n) => (ladder[String(n)] ?? 0) / n);
  const maxPer = Math.max(1, ...perCourse);
  const [first, setFirst] = useState('75');
  const [drop, setDrop] = useState('2.5');
  const changed = !sameLadder(ladder, saved);
  const suggested = sameLadder(ladder, PACK_LADDER_RUPEES);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink2">Pack prices</span>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          {changed && (
            <button type="button" className={linkButton} onClick={() => onDraft(toDraft(saved))}>
              Undo price changes
            </button>
          )}
          {!suggested && (
            <button type="button" className={linkButton} onClick={() => onDraft(toDraft(PACK_LADDER_RUPEES))}>
              Use suggested prices
            </button>
          )}
        </div>
      </div>
      <ul
        className="m-0 p-0 list-none grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5"
        aria-label="Pack prices"
      >
        {PACK_SIZES.map((n, i) => {
          const key = String(n);
          const rupees = ladder[key] ?? 0;
          const per = perCourse[i] ?? 0;
          const problem = bad.get(n);
          // Whole rupees: "saves ~₹33", not "~₹33.28".
          const save = avgPaise && rupees ? Math.floor((avgPaise * n - rupees * 100) / 100) * 100 : null;
          const edited = saved[key] !== rupees;
          return (
            <li
              key={n}
              className={`flex flex-col gap-1 rounded-xl px-2.5 py-2 border-[1.5px] ${
                problem
                  ? 'border-blush-text bg-blush/40'
                  : edited
                    ? 'border-marigold bg-marigold-soft'
                    : 'border-transparent bg-sunk'
              }`}
            >
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-ink2">{n} courses</span>
                <span className="flex items-center gap-0.5">
                  <span className="font-mono text-[14px] text-ink2">₹</span>
                  <input
                    className="w-full min-w-0 bg-transparent border-0 p-0 font-mono text-[16px] font-bold text-ink outline-none focus:underline decoration-teal decoration-2 underline-offset-4"
                    inputMode="numeric"
                    maxLength={5}
                    aria-label={`Price for ${n} courses, rupees`}
                    aria-invalid={!!problem}
                    value={draft[key] ?? ''}
                    onChange={(e) => onDraft({ ...draft, [key]: e.target.value.replace(/\D/g, '') })}
                  />
                </span>
              </label>
              {/* Price per course as a bar: it should step down from left to right. */}
              <span aria-hidden="true" className="h-1.5 rounded-full bg-line overflow-hidden">
                <span
                  className={`block h-full rounded-full ${problem ? 'bg-blush-text' : 'bg-teal'}`}
                  style={{ width: `${Math.min(100, (per / maxPer) * 100)}%` }}
                />
              </span>
              <span className="text-[11.5px] tabular-nums text-ink2">
                {rupees ? `₹${Number.isInteger(per) ? per : per.toFixed(2)} a course` : '—'}
              </span>
              {save !== null && save > 0 && !problem && (
                <span className="text-[11.5px] tabular-nums text-teal-text">saves ~{formatMoney(save)}</span>
              )}
            </li>
          );
        })}
      </ul>
      {problems.length > 0 ? (
        <ul className="m-0 pl-4 text-[13px] text-blush-text" aria-label="Price problems">
          {problems.map((p) => (
            <li key={p.size}>
              {p.size} courses: {p.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[13px] text-ink2">
          Each bigger pack costs more in total and less per course. Packs over 10 courses add a little less
          than the average course each, so the rule holds for them too.
        </p>
      )}
      <details className="text-[13px]">
        <summary className="cursor-pointer font-semibold text-teal-text">Set every price from a rule</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <Field label="₹ a course for 2 courses">
            <input
              className={`${input} w-28 font-mono`}
              inputMode="decimal"
              value={first}
              onChange={(e) => setFirst(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
          <Field label="₹ less a course per size">
            <input
              className={`${input} w-28 font-mono`}
              inputMode="decimal"
              value={drop}
              onChange={(e) => setDrop(e.target.value.replace(/[^\d.]/g, ''))}
            />
          </Field>
          <Button
            variant="outline"
            disabled={!(Number(first) >= 5) || !(Number(drop) >= 0)}
            onClick={() => onDraft(toDraft(ladderFromRule(Number(first), Number(drop))))}
          >
            Fill every size
          </Button>
          <span className="text-ink2 max-w-[360px]">
            Fills all nine boxes at once (ending in 9). Nothing changes on the site until you apply.
          </span>
        </div>
      </details>
    </div>
  );
}

/**
 * Drawer packs: one bundle per drawer with every live course in it, priced from the admin's price
 * list. Every change (prices, name, status) previews live against the real drawers; one button
 * applies it to every pack at once. Their own name fits all year; while an offer runs, students
 * see them under the offer's name ("Diwali pack · 2025 BCE") and it goes back when the offer ends.
 */
export function PacksCard() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['admin-packs'], queryFn: api.adminPacks });
  const offers = useQuery({ queryKey: ['admin-offers'], queryFn: api.adminOffers });
  const runningOffer = offers.data?.find((o) => o.running);
  const [prefix, setPrefix] = useState('');
  const [status, setStatus] = useState<'draft' | 'live'>('live');
  const [sync, setSync] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [built, setBuilt] = useState<PackRunDto | null>(null);
  const [open, setOpen] = useState(false);
  // An older server (mid-deploy) may not send a price list yet: fall back to the suggested one.
  const savedSettings = saved.data?.settings;
  const s = useMemo(
    () =>
      savedSettings ? { ...savedSettings, ladder: savedSettings.ladder ?? PACK_LADDER_RUPEES } : undefined,
    [savedSettings],
  );

  const loadSaved = (x: PackRunDto['settings']) => {
    // A festival name is not carried into the box: it starts on an all-year name, and the notice
    // above explains the one-click fix for packs that already have one.
    setPrefix(isFestivePackName(x.titlePrefix) ? ALL_YEAR : x.titlePrefix);
    setStatus(x.status);
    setSync(x.keepInSync);
    setDraft(toDraft(x.ladder));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: start the form once, from what was saved.
  useEffect(() => {
    if (s && !draft) loadSaved(s);
  }, [s, draft]);

  const ladder = useMemo(() => (draft ? fromDraft(draft) : null), [draft]);
  const ladderOk = !!ladder && ladderProblems(ladder).length === 0;
  const name = prefix.trim();
  const festiveTyped = isFestivePackName(name);
  const formOk = ladderOk && name.length >= 2 && !festiveTyped;
  const settingsChanged =
    !!s &&
    !!ladder &&
    (name !== s.titlePrefix || status !== s.status || sync !== s.keepInSync || !sameLadder(ladder, s.ladder));

  // Live preview: a moment after typing stops, every change is checked against the real drawers.
  const bodyKey =
    ladder && formOk && settingsChanged
      ? JSON.stringify({ dryRun: true, status, titlePrefix: name, keepInSync: sync, ladder })
      : '';
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(bodyKey), 450);
    return () => clearTimeout(t);
  }, [bodyKey]);
  const preview = useQuery({
    queryKey: ['admin-packs-preview', debounced],
    queryFn: () => api.adminRunPacks(JSON.parse(debounced)),
    enabled: !!debounced && debounced === bodyKey,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const build = useMutation({
    mutationFn: (rename?: string) =>
      rename
        ? // One click: rename every pack, keeping every other saved setting.
          api.adminRunPacks({
            dryRun: false,
            status: s?.status ?? status,
            titlePrefix: rename,
            keepInSync: s?.keepInSync ?? sync,
            ...(s ? { ladder: s.ladder } : {}),
          })
        : api.adminRunPacks({ dryRun: false, status, titlePrefix: name, keepInSync: sync, ladder: ladder! }),
    onSuccess: (r, rename) => {
      setBuilt(r);
      // What was just built is now the saved state: the form compares against it from here.
      qc.setQueryData(['admin-packs'], { ...r, applied: false });
      // …and fetch the server's own view in the background ("up to date" counts).
      void qc.invalidateQueries({ queryKey: ['admin-packs'] });
      if (rename) setPrefix(rename);
      // Old previews are now out of date: drop them (no refetch, nothing is being edited).
      qc.removeQueries({ queryKey: ['admin-packs-preview'] });
      for (const k of ['admin-bundles', 'bundles', 'bundle', 'course', 'admin-offers'])
        void qc.invalidateQueries({ queryKey: [k] });
    },
  });

  // The summary and table: the live preview while editing, else the last build or the saved state.
  const live = !!bodyKey && debounced === bodyKey && preview.data ? preview.data : null;
  const data = settingsChanged ? (live ?? null) : (built ?? saved.data);
  const previewing = !!bodyKey && (debounced !== bodyKey || preview.isFetching);
  const packs = data?.plans.filter((p) => p.action !== 'skip') ?? [];
  const years = [...new Set(packs.map((p) => p.batchYear))];
  const current = s?.titlePrefix ?? '';
  const builtPacks = saved.data ? saved.data.totals.same + saved.data.totals.update : 0;
  const festiveNow = builtPacks > 0 && isFestivePackName(current);
  const prices = saved.data?.coursePrices ?? null;
  const five = ladder?.['5'];
  const pending = data ? data.totals.create + data.totals.update + data.totals.retire : 0;
  const summary = data
    ? `${plural(data.totals.create, 'new pack')} · ${data.totals.update} to update · ${data.totals.same} up to date${
        data.totals.retire ? ` · ${data.totals.retire} off sale` : ''
      }`
    : '';

  return (
    <section
      aria-labelledby="packs-title"
      className="rounded-[22px] border border-line bg-surface p-5 flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="packs-title" className="m-0 text-[19px] font-semibold">
          Drawer packs
        </h3>
        <span className="text-sm text-ink2">
          One bundle for every batch and programme: all the live courses in that drawer.
        </span>
      </div>

      {festiveNow && (
        <div
          role="alert"
          className="rounded-2xl border border-marigold/60 bg-marigold-soft px-4 py-3 flex flex-col gap-2"
        >
          <p className="m-0 text-[14px] text-ink">
            <strong>Your packs are called "{current}"</strong>{' '}
            {runningOffer
              ? `and will keep that name after "${runningOffer.title}" ends.`
              : 'but no offer is running, so students see a festival name with normal prices.'}{' '}
            Packs now take the running offer's name by themselves, so give them a name that fits all year.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="buy" disabled={build.isPending} onClick={() => build.mutate(ALL_YEAR)}>
              {build.isPending && build.variables ? 'Renaming…' : `Rename every pack to "${ALL_YEAR}"`}
            </Button>
            <span className="text-[13px] text-ink2">Prices, courses and drawers stay as they are.</span>
          </div>
        </div>
      )}

      {saved.isError && !saved.data ? (
        <p className="m-0 text-sm text-blush-text">
          Packs didn't load: {friendly(saved.error)}{' '}
          <button type="button" className={linkButton} onClick={() => saved.refetch()}>
            Try again
          </button>
        </p>
      ) : !draft || !s ? (
        <Skeleton className="h-28 rounded-2xl" />
      ) : (
        <LadderEditor
          draft={draft}
          onDraft={setDraft}
          saved={s.ladder}
          avgPaise={prices?.averagePaise ?? null}
        />
      )}
      {prices && five && ladderOk && (
        <p className="m-0 text-[13px] text-ink2">
          Your live courses are {formatRupees(prices.minPaise)}
          {prices.maxPaise !== prices.minPaise ? ` to ${formatRupees(prices.maxPaise)}` : ''} one by one (
          {formatMoney(prices.averagePaise)} on average), so a 5-course pack at ₹{five} saves about{' '}
          <strong className="text-ink">
            {formatMoney(Math.max(0, Math.floor((prices.averagePaise * 5 - five * 100) / 100) * 100))}
          </strong>
          . A pack is never priced above 92% of its own courses one by one; the drawer list says when one is
          lowered for that.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Pack name" className="w-full sm:w-64">
          <input
            className={input}
            value={prefix}
            maxLength={40}
            placeholder={ALL_YEAR}
            aria-invalid={festiveTyped}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5 pb-1">
          {NAMES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPrefix(n)}
              className={`h-8 rounded-full px-3 whitespace-nowrap text-[12.5px] font-semibold border cursor-pointer ${
                prefix === n ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <Field label="On the site">
          <select
            className={input}
            value={status}
            onChange={(e) => setStatus(e.target.value as 'draft' | 'live')}
          >
            <option value="live">Live straight away</option>
            <option value="draft">As drafts</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm pb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={sync}
            onChange={(e) => setSync(e.target.checked)}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          Keep in step every hour
        </label>
      </div>
      {festiveTyped ? (
        <p className="m-0 text-[13px] text-blush-text">
          Leave festival names out: while an offer runs, packs are shown under the offer's name by themselves
          (a "Diwali offer" shows them as "Diwali pack · 2025 BCE"), and they go back to this name when it
          ends. Pick a name that fits all year, like "{ALL_YEAR}".
        </p>
      ) : (
        <p className="m-0 text-[13px] text-ink2">
          Titles read "{name || ALL_YEAR} · 2025 BCE".{' '}
          {runningOffer ? (
            <>
              Right now "{runningOffer.title}" is running, so the packs it covers show as{' '}
              <strong className="text-ink">"{offerPackName(runningOffer.title)} · 2025 BCE"</strong> at the
              offer price, and go back to this name when it ends.
            </>
          ) : (
            <>
              While an offer runs, the packs it covers show under its name (a "Diwali offer" makes them
              "Diwali pack · 2025 BCE") at the offer price, and go back to this name when it ends.
            </>
          )}{' '}
          Kept in step, a pack takes in a course as soon as it goes live in that drawer and drops one that
          leaves.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="buy"
          disabled={build.isPending || !formOk || (settingsChanged && (previewing || !live))}
          onClick={() => build.mutate(undefined)}
        >
          {build.isPending && !build.variables
            ? 'Applying…'
            : !settingsChanged
              ? 'Build packs'
              : !formOk
                ? 'Apply changes'
                : live && !previewing
                  ? `Apply to ${plural(pending, 'pack')}`
                  : 'Checking…'}
        </Button>
        {settingsChanged && s && (
          <Button variant="ghost" disabled={build.isPending} onClick={() => loadSaved(s)}>
            Discard changes
          </Button>
        )}
        <span className="text-sm text-ink2" aria-live="polite">
          {settingsChanged
            ? !formOk
              ? 'Fix the highlighted prices or name to see what would change.'
              : previewing && !live
                ? 'Checking every drawer…'
                : live
                  ? `If applied: ${summary}`
                  : ''
            : data
              ? `${built ? 'Done: ' : ''}${summary}`
              : ''}
        </span>
        {data && (
          <button
            type="button"
            className="ml-auto text-sm font-semibold text-teal-text underline cursor-pointer bg-transparent border-0"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
          >
            {open ? 'Hide drawers' : `Show ${plural(packs.length, 'drawer')}`}
          </button>
        )}
      </div>
      {build.isError && <p className="m-0 text-sm text-blush-text">{friendly(build.error)}</p>}
      {preview.isError && !!bodyKey && (
        <p className="m-0 text-sm text-blush-text">
          The preview didn't load: {friendly(preview.error)}{' '}
          <button type="button" className={linkButton} onClick={() => preview.refetch()}>
            Try again
          </button>
        </p>
      )}

      {open && data && (
        <div
          className={`max-h-[420px] overflow-auto rounded-xl border border-line transition-opacity ${
            previewing ? 'opacity-60' : ''
          }`}
        >
          <table className="w-full min-w-[620px] text-sm border-collapse">
            <caption className="sr-only">Packs by drawer</caption>
            <thead className="sticky top-0 bg-surface shadow-[0_1px_0_var(--line)]">
              <tr className="text-left text-ink2">
                <th className="py-2 px-3 font-semibold">Drawer</th>
                <th className="py-2 px-3 font-semibold">Courses</th>
                <th className="py-2 px-3 font-semibold text-right">One by one</th>
                <th className="py-2 px-3 font-semibold text-right">Pack</th>
                <th className="py-2 px-3 font-semibold">Change</th>
              </tr>
            </thead>
            {years.map((y) => (
              <tbody key={y}>
                {packs
                  .filter((p) => p.batchYear === y)
                  .map((p) => (
                    <tr key={`${p.batchYear}:${p.branchSlug}`} className="border-t border-line/70 align-top">
                      <td className="py-2 px-3 whitespace-nowrap font-semibold">
                        {p.batchYear} {p.branchCode}
                      </td>
                      <td className="py-2 px-3 text-ink2">
                        <span className="text-ink">{p.courseCount}</span>
                        {p.courseTitles.length > 0 && (
                          <span className="block text-[12px] leading-snug">{p.courseTitles.join(', ')}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-ink2 line-through decoration-1 tabular-nums">
                        {p.listPricePaise ? formatRupees(p.listPricePaise) : ''}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold tabular-nums whitespace-nowrap">
                        {p.pricePaise ? formatRupees(p.pricePaise) : ''}
                        {p.savePercent > 0 && (
                          <span className="block text-[12px] font-normal text-teal-text">
                            save {p.savePercent}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex h-6 px-2 rounded-md text-[12px] font-semibold items-center whitespace-nowrap ${ACTION[p.action].style}`}
                        >
                          {ACTION[p.action].label}
                        </span>
                        {p.note && (
                          <span className="block mt-1 text-[12px] text-ink2 max-w-[280px]">{p.note}</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
          {packs.length === 0 && (
            <p className="m-0 p-3 text-sm text-ink2">No drawer has two live courses yet.</p>
          )}
        </div>
      )}
    </section>
  );
}
