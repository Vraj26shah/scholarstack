import {
  PACK_LADDER_RUPEES,
  type PackPlanDto,
  type PackRunDto,
  isFestivePackName,
  offerPackName,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
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

/**
 * Drawer packs: one bundle per drawer with every live course in it, priced on the ladder. Build
 * them all at once, preview first, and let them follow the drawers every hour as courses go live.
 * Their own name fits all year; while an offer runs, students see them under the offer's name
 * ("Diwali pack · 2025 BCE") and the name goes back when the offer ends.
 */
export function PacksCard() {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['admin-packs'], queryFn: api.adminPacks });
  const offers = useQuery({ queryKey: ['admin-offers'], queryFn: api.adminOffers });
  const runningOffer = offers.data?.find((o) => o.running);
  const [prefix, setPrefix] = useState('');
  const [status, setStatus] = useState<'draft' | 'live'>('live');
  const [sync, setSync] = useState(true);
  const [shown, setShown] = useState<PackRunDto | null>(null);
  const [open, setOpen] = useState(false);
  // Start the form from what was saved last time.
  useEffect(() => {
    if (!saved.data || prefix) return;
    setPrefix(saved.data.settings.titlePrefix);
    setStatus(saved.data.settings.status);
    setSync(saved.data.settings.keepInSync || saved.data.plans.every((p) => p.action !== 'same'));
  }, [saved.data, prefix]);

  const run = useMutation({
    mutationFn: (args: boolean | { rename: string }) =>
      typeof args === 'boolean'
        ? api.adminRunPacks({
            dryRun: args,
            status,
            titlePrefix: prefix.trim() || ALL_YEAR,
            keepInSync: sync,
          })
        : // One click: rename every pack, keeping the saved status and hourly sync.
          api.adminRunPacks({
            dryRun: false,
            status: saved.data?.settings.status ?? status,
            titlePrefix: args.rename,
            keepInSync: saved.data?.settings.keepInSync ?? sync,
          }),
    onSuccess: (r, args) => {
      setShown(r);
      setOpen(typeof args === 'boolean');
      if (typeof args !== 'boolean') setPrefix(args.rename);
      if (r.applied)
        for (const k of ['admin-bundles', 'admin-packs', 'bundles', 'bundle', 'course', 'admin-offers'])
          void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const data = shown ?? saved.data;
  // The name the packs carry now (what students see when no offer runs).
  const current = data?.settings.titlePrefix ?? '';
  const builtPacks = data ? data.totals.same + data.totals.update : 0;
  const festiveNow = builtPacks > 0 && isFestivePackName(current);
  const festiveTyped = isFestivePackName(prefix);
  const packs = data?.plans.filter((p) => p.action !== 'skip') ?? [];
  const years = [...new Set(packs.map((p) => p.batchYear))];

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
            <Button
              size="sm"
              variant="buy"
              disabled={run.isPending}
              onClick={() => run.mutate({ rename: ALL_YEAR })}
            >
              {run.isPending && typeof run.variables === 'object'
                ? 'Renaming…'
                : `Rename every pack to "${ALL_YEAR}"`}
            </Button>
            <span className="text-[13px] text-ink2">Prices, courses and drawers stay as they are.</span>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink2">Pack prices</span>
        <ul
          className="m-0 p-0 list-none flex flex-wrap gap-1.5"
          aria-label="Pack prices by number of courses"
        >
          {Object.entries(PACK_LADDER_RUPEES).map(([n, r]) => (
            <li
              key={n}
              className={`flex flex-col items-center rounded-xl px-3 py-1.5 min-w-[4.5rem] ${
                n === '5' ? 'bg-marigold-soft text-marigold-text' : 'bg-sunk text-ink2'
              }`}
            >
              <span className="text-[11.5px]">{n} courses</span>
              <strong className={`font-mono text-[15px] ${n === '5' ? '' : 'text-ink'}`}>₹{r}</strong>
            </li>
          ))}
        </ul>
        <p className="m-0 text-[13px] text-ink2">
          One by one a course is ₹79 to ₹99, so a 5-course pack saves about ₹146.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Pack name" className="w-full sm:w-64">
          <input
            className={input}
            value={prefix}
            maxLength={40}
            placeholder={ALL_YEAR}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap gap-1.5 pb-1">
          {NAMES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setPrefix(name)}
              className={`h-8 rounded-full px-3 whitespace-nowrap text-[12.5px] font-semibold border cursor-pointer ${
                prefix === name ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {name}
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
          Titles read "{prefix.trim() || ALL_YEAR} · 2025 BCE".{' '}
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
        <Button variant="outline" disabled={run.isPending} onClick={() => run.mutate(true)}>
          {run.isPending && run.variables === true ? 'Checking…' : 'Preview'}
        </Button>
        <Button
          variant="buy"
          disabled={run.isPending || !prefix.trim() || festiveTyped}
          onClick={() => run.mutate(false)}
        >
          {run.isPending && run.variables === false ? 'Building…' : 'Build packs'}
        </Button>
        {data && (
          <span className="text-sm text-ink2">
            {data.applied ? 'Done: ' : ''}
            {plural(data.totals.create, 'new pack')} · {data.totals.update} to update · {data.totals.same} up
            to date
            {data.totals.retire ? ` · ${data.totals.retire} off sale` : ''}
          </span>
        )}
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
      {run.isError && <p className="m-0 text-sm text-blush-text">{friendly(run.error)}</p>}
      {saved.isLoading && <Skeleton className="h-10" />}

      {open && data && (
        <div className="max-h-[420px] overflow-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm border-collapse">
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
                        {p.note && <span className="block text-[12px]">{p.note}</span>}
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
