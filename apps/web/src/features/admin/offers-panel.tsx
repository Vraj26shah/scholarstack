import type { AdminBundleDto, AdminCourseDto, AdminOfferDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { DrawerPicker, DrawerSummary, drawerKey, fromKey } from './drawer-picker';
import { Field, Panel, input, plural } from './ui';

interface Form {
  id?: string;
  title: string;
  percent: string;
  starts: string;
  ends: string;
  everything: boolean;
  courseIds: string[];
  bundleIds: string[];
  drawers: Set<string>;
}

/** "2026-11-09T18:30" for a datetime-local box, in the admin's own time zone. */
const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const DAY = 24 * 60 * 60 * 1000;
/** Same rule as the server: the percentage off, then down to the nearest price ending in 9. */
const offerPrice = (paise: number, pct: number) => {
  const rupees = Math.floor((paise * (100 - pct)) / 10000 + 1e-9);
  return Math.max(100, (rupees >= 20 ? rupees - ((rupees + 1) % 10) : rupees) * 100);
};
const iso = (v: string) => new Date(v).toISOString();
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function newOffer(): Form {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 5 * DAY);
  end.setHours(23, 59, 0, 0);
  return {
    title: 'Diwali offer',
    percent: '20',
    starts: local(start),
    ends: local(end),
    everything: true,
    courseIds: [],
    bundleIds: [],
    drawers: new Set(),
  };
}

function useOfferRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['admin-offers', 'admin-bundles', 'drawer', 'bundles', 'bundle', 'course', 'search'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

function phase(o: AdminOfferDto): 'running' | 'scheduled' | 'ended' | 'draft' {
  if (o.status === 'draft') return 'draft';
  if (o.running) return 'running';
  return new Date(o.startsAt) > new Date() ? 'scheduled' : 'ended';
}

const PHASE_STYLE: Record<ReturnType<typeof phase>, string> = {
  running: 'bg-mist text-on-mist',
  scheduled: 'bg-marigold-soft text-marigold-text',
  ended: 'bg-sunk text-ink2',
  draft: 'bg-sunk text-ink2',
};

function OfferForm({
  initial,
  courses,
  bundles,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; bundles: AdminBundleDto[]; onDone: () => void }) {
  const refresh = useOfferRefresh();
  const [f, setF] = useState<Form>(initial);
  const [q, setQ] = useState('');
  const pct = Number(f.percent);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const live = courses.filter((c) => c.status === 'live');
  const shown = words.length
    ? live
        .filter((c) =>
          words.every((w) =>
            [c.title, c.courseCode ?? '', String(c.batchYear), ...c.branchSlugs]
              .join(' ')
              .toLowerCase()
              .includes(w),
          ),
        )
        .slice(0, 40)
    : [];
  const chosen = courses.filter((c) => f.courseIds.includes(c.id));
  const ok =
    f.title.trim().length >= 2 &&
    pct >= 1 &&
    pct <= 90 &&
    !!f.starts &&
    !!f.ends &&
    new Date(f.ends) > new Date(f.starts) &&
    (f.everything || f.courseIds.length + f.bundleIds.length + f.drawers.size > 0);
  const save = useMutation({
    mutationFn: (status: 'draft' | 'live') =>
      api.adminSaveOffer({
        ...(f.id ? { id: f.id } : {}),
        title: f.title.trim(),
        percentOff: pct,
        startsAt: iso(f.starts),
        endsAt: iso(f.ends),
        status,
        everything: f.everything,
        courseIds: f.courseIds,
        bundleIds: f.bundleIds,
        drawers: [...f.drawers].map(fromKey),
      }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const toggle = (key: 'courseIds' | 'bundleIds', id: string) =>
    setF((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((v) => v !== id) : [...x[key], id] }));
  const example = live[0];

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
        <Field label="Name students see">
          <input
            className={input}
            value={f.title}
            maxLength={60}
            placeholder="Diwali offer"
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label="Percent off">
          <input
            className={`${input} font-mono`}
            value={f.percent}
            inputMode="numeric"
            maxLength={2}
            onChange={(e) => setF({ ...f, percent: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="Starts">
          <input
            type="datetime-local"
            className={input}
            value={f.starts}
            onChange={(e) => setF({ ...f, starts: e.target.value })}
          />
        </Field>
        <Field label="Ends">
          <input
            type="datetime-local"
            className={input}
            value={f.ends}
            onChange={(e) => setF({ ...f, ends: e.target.value })}
          />
        </Field>
      </div>
      {example && pct >= 1 && pct <= 90 && (
        <p className="m-0 text-sm text-ink2">
          A {formatRupees(example.pricePaise)} course sells for{' '}
          <strong className="text-ink">{formatRupees(offerPrice(example.pricePaise, pct))}</strong>. Offer
          prices go down to the nearest price ending in 9, so students never get less off than you promised.
        </p>
      )}

      <fieldset className="m-0 p-4 rounded-2xl border border-line flex flex-col gap-3">
        <legend className="px-1 font-semibold">What it covers</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What the offer covers">
          {(
            [
              [true, 'Everything on sale'],
              [false, 'Choose'],
            ] as const
          ).map(([everything, text]) => (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={f.everything === everything}
              onClick={() => setF({ ...f, everything })}
              className={`h-9 rounded-full px-3.5 text-[13px] font-semibold border cursor-pointer ${
                f.everything === everything
                  ? 'bg-brand text-white border-brand'
                  : 'border-line text-ink2 hover:text-ink'
              }`}
            >
              {text}
            </button>
          ))}
        </div>
        {f.everything ? (
          <p className="m-0 text-sm text-ink2">
            Every live course and bundle, for every batch and programme.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Batches and programmes</span>
              <p className="m-0 text-[13px] text-ink2">
                Everything their drawers show, including courses shared with other years.
              </p>
              <DrawerPicker
                label="Batches and programmes the offer covers"
                value={f.drawers}
                onChange={(drawers) => setF((x) => ({ ...x, drawers }))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">
                Single courses <span className="tabular-nums text-ink2">({chosen.length})</span>
              </span>
              {chosen.length > 0 && (
                <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5" aria-label="Courses in the offer">
                  {chosen.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-label={`Remove ${c.title}`}
                        onClick={() => toggle('courseIds', c.id)}
                        className="h-8 px-3 rounded-full border text-[13px] cursor-pointer border-teal bg-mist/25 text-ink"
                      >
                        {c.title} <span className="font-mono text-[11px] text-ink2">{c.batchYear}</span> ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                type="search"
                aria-label="Search courses for the offer"
                placeholder="Search a course by name or code"
                className={`${input} h-10 text-sm sm:w-80`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {shown.length > 0 && (
                <ul className="m-0 p-0 list-none max-h-[220px] overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2 pr-1">
                  {shown.map((c) => (
                    <li key={c.id}>
                      <label
                        className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer border-[1.5px] ${
                          f.courseIds.includes(c.id) ? 'border-teal bg-mist/25' : 'border-transparent bg-sunk'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={f.courseIds.includes(c.id)}
                          onChange={() => toggle('courseIds', c.id)}
                          className="w-5 h-5 accent-[var(--teal)] shrink-0"
                        />
                        <span className="min-w-0 text-sm truncate" title={c.title}>
                          {c.title}{' '}
                          <span className="font-mono text-[11px] text-ink2">
                            {c.courseCode ?? ''} {c.batchYear}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {bundles.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Bundles</span>
                <div className="flex flex-wrap gap-1.5">
                  {bundles.map((b) => {
                    const on = f.bundleIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle('bundleIds', b.id)}
                        className={`h-9 rounded-full px-3 text-[13px] font-semibold border cursor-pointer ${
                          on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
                        }`}
                      >
                        {b.title}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="buy" disabled={!ok || save.isPending} onClick={() => save.mutate('live')}>
          {save.isPending ? 'Saving…' : 'Save and switch on'}
        </Button>
        <Button variant="outline" disabled={!ok || save.isPending} onClick={() => save.mutate('draft')}>
          Save as draft
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {f.ends && f.starts && new Date(f.ends) <= new Date(f.starts) && (
          <span className="text-sm text-blush-text">The offer has to end after it starts.</span>
        )}
      </div>
      <p className="m-0 text-[13px] text-ink2">
        When two offers cover the same course, students get the bigger one. Offers never add up, and a bundle
        never costs more than its courses bought one by one during the sale.
      </p>
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </div>
  );
}

function OfferRow({ o, onEdit, onCopy }: { o: AdminOfferDto; onEdit: () => void; onCopy: () => void }) {
  const refresh = useOfferRefresh();
  const [confirm, setConfirm] = useState(false);
  const p = phase(o);
  const body = (patch: Partial<{ status: 'draft' | 'live'; endsAt: string }>) => ({
    id: o.id,
    title: o.title,
    percentOff: o.percentOff,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    status: o.status,
    everything: o.everything,
    courseIds: o.courseIds,
    bundleIds: o.bundleIds,
    drawers: o.drawers,
    ...patch,
  });
  const change = useMutation({
    mutationFn: (patch: Partial<{ status: 'draft' | 'live'; endsAt: string }>) =>
      api.adminSaveOffer(body(patch)),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: () => api.adminDeleteOffer(o.id), onSuccess: refresh });
  const covers = o.everything
    ? 'Everything'
    : [
        o.courseIds.length ? plural(o.courseIds.length, 'course') : '',
        o.bundleIds.length ? plural(o.bundleIds.length, 'bundle') : '',
      ]
        .filter(Boolean)
        .join(' · ');
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={`inline-flex items-center h-6 px-2.5 rounded-md text-[12px] font-semibold capitalize ${PHASE_STYLE[p]}`}
        >
          {p}
        </span>
        <div className="flex-[1_1_260px] min-w-0">
          <div className="font-semibold">
            {o.title} <span className="text-teal-text">· {o.percentOff}% off</span>
          </div>
          <div className="font-mono text-xs text-ink2">
            {when(o.startsAt)} to {when(o.endsAt)}
          </div>
          <div className="text-[13px] text-ink2">
            {covers}
            {covers && o.drawers.length ? ' · ' : ''}
            {o.drawers.length > 0 && <DrawerSummary drawers={o.drawers} empty="" />}
            {' · '}reaches {plural(o.reach.courses, 'live course')} and {plural(o.reach.bundles, 'bundle')}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {p === 'running' && (
            <Button
              variant="outline"
              size="sm"
              disabled={change.isPending}
              onClick={() => change.mutate({ endsAt: new Date(Date.now() + 1000).toISOString() })}
            >
              End now
            </Button>
          )}
          {o.status === 'draft' && p !== 'ended' && (
            <Button size="sm" disabled={change.isPending} onClick={() => change.mutate({ status: 'live' })}>
              Switch on
            </Button>
          )}
          {o.status === 'live' && p === 'scheduled' && (
            <Button
              variant="outline"
              size="sm"
              disabled={change.isPending}
              onClick={() => change.mutate({ status: 'draft' })}
            >
              Switch off
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={onCopy}>
            Run again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      </div>
      {change.isError && <p className="m-0 text-sm text-blush-text">{friendly(change.error)}</p>}
      {confirm && (
        <Sheet open onOpenChange={(v) => !v && setConfirm(false)} title={`Delete “${o.title}”?`}>
          <p className="m-0 text-[15px]">
            Prices go back to normal at once. Orders already paid keep what they paid.
          </p>
          {del.isError && <p className="m-0 text-sm text-blush-text">{friendly(del.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ink" disabled={del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? 'Deleting…' : 'Delete offer'}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      )}
    </li>
  );
}

const toForm = (o: AdminOfferDto): Form => ({
  id: o.id,
  title: o.title,
  percent: String(o.percentOff),
  starts: local(new Date(o.startsAt)),
  ends: local(new Date(o.endsAt)),
  everything: o.everything,
  courseIds: o.courseIds,
  bundleIds: o.bundleIds,
  drawers: new Set(o.drawers.map(drawerKey)),
});

/**
 * Offers: a percentage off for a set time, on everything or on chosen courses, bundles and
 * drawers. The prices on courses and bundles are never edited, so ending an offer is instant.
 */
export function OffersPanel() {
  const offers = useQuery({ queryKey: ['admin-offers'], queryFn: api.adminOffers });
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const bundles = useQuery({ queryKey: ['admin-bundles'], queryFn: api.adminBundles });
  const [editing, setEditing] = useState<Form | null>(null);
  const liveBundles = (bundles.data ?? []).filter((b) => b.status === 'live');

  return (
    <Panel
      title="Offers"
      aside={
        !editing && (
          <Button variant="buy" onClick={() => setEditing(newOffer())}>
            New offer
          </Button>
        )
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[760px]">
        A sale for a few days, like a Diwali offer. Students see the old price struck through and the offer's
        name on every card it covers. Checkout charges the same price, and when the offer ends the normal
        prices are back by themselves.
      </p>
      {editing && courses.data && (
        <OfferForm
          key={editing.id ?? 'new'}
          initial={editing}
          courses={courses.data}
          bundles={liveBundles}
          onDone={() => setEditing(null)}
        />
      )}
      {offers.isLoading ? (
        <Skeleton className="h-32" />
      ) : offers.isError && !offers.data ? (
        <ErrorState
          title="Offers didn't load."
          message={friendly(offers.error)}
          onRetry={() => offers.refetch()}
        />
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
          {(offers.data ?? []).map((o) => (
            <OfferRow
              key={o.id}
              o={o}
              onEdit={() => setEditing(toForm(o))}
              onCopy={() => {
                const fresh = newOffer();
                setEditing({ ...toForm(o), id: undefined, starts: fresh.starts, ends: fresh.ends });
              }}
            />
          ))}
          {offers.data?.length === 0 && <li className="text-ink2">No offers yet.</li>}
        </ul>
      )}
    </Panel>
  );
}
