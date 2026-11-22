import type { AdminBundleDto, AdminCourseDto, AdminPromoCodeDto, PromoAppliesTo } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { formatMoney, formatRupees } from '../../lib/format';
import { Button } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { UsedBy } from './discount-orders';
import { BundlePicker, CoursePicker } from './item-picker';
import { Field, Panel, input, plural } from './ui';

interface Form {
  id?: string;
  code: string;
  kind: 'percent' | 'flat';
  /** Percent, or rupees for a flat code. */
  amount: string;
  appliesTo: PromoAppliesTo;
  courseIds: string[];
  bundleIds: string[];
  starts: string;
  ends: string;
  noEnd: boolean;
  maxUses: string;
  oncePerStudent: boolean;
  newStudentsOnly: boolean;
  creatorName: string;
  creatorContact: string;
  /** '' = no commission. */
  commissionKind: '' | 'percent' | 'flat';
  /** Percent, or rupees per use. */
  commission: string;
}

const APPLIES: [PromoAppliesTo, string, string][] = [
  ['everything', 'Everything', 'Works on every course and every bundle.'],
  ['courses', 'All courses', 'Works on every single course, not on bundles.'],
  ['bundles', 'All bundles', 'Works on every bundle, not on single courses.'],
  ['chosen', 'Choose', ''],
];

/** "2026-11-09T18:30" for a datetime-local box, in the admin's own time zone. */
const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const DAY = 24 * 60 * 60 * 1000;
const iso = (v: string) => new Date(v).toISOString();
const when = (v: string) =>
  new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const CODE_RE = /^[A-Z0-9_-]{3,24}$/;

/** Same rule as the server: percent rounds down to the rupee; never below ₹1. */
const codePrice = (paise: number, kind: Form['kind'], amount: number) => {
  if (paise <= 100) return paise;
  const next =
    kind === 'percent' ? Math.floor((paise * (100 - amount)) / 100 / 100) * 100 : paise - amount * 100;
  return Math.min(paise, Math.max(100, next));
};

const offLabel = (p: Pick<AdminPromoCodeDto, 'kind' | 'percentOff' | 'amountOffPaise'>) =>
  p.kind === 'percent' ? `${p.percentOff}% off` : `${formatRupees(p.amountOffPaise ?? 0)} off`;

function newCode(): Form {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 7 * DAY);
  end.setHours(23, 59, 0, 0);
  return {
    code: '',
    kind: 'percent',
    amount: '10',
    appliesTo: 'everything',
    courseIds: [],
    bundleIds: [],
    starts: local(start),
    ends: local(end),
    noEnd: false,
    maxUses: '',
    oncePerStudent: true,
    newStudentsOnly: false,
    creatorName: '',
    creatorContact: '',
    commissionKind: '',
    commission: '',
  };
}

const toForm = (p: AdminPromoCodeDto): Form => ({
  id: p.id,
  code: p.code,
  kind: p.kind,
  amount: String(p.kind === 'percent' ? p.percentOff : (p.amountOffPaise ?? 0) / 100),
  appliesTo: p.appliesTo,
  courseIds: p.courseIds,
  bundleIds: p.bundleIds,
  starts: local(new Date(p.startsAt)),
  ends: p.endsAt ? local(new Date(p.endsAt)) : newCode().ends,
  noEnd: p.endsAt === null,
  maxUses: p.maxUses === null ? '' : String(p.maxUses),
  oncePerStudent: p.oncePerStudent,
  newStudentsOnly: p.newStudentsOnly,
  creatorName: p.creatorName ?? '',
  creatorContact: p.creatorContact ?? '',
  commissionKind: p.commissionKind ?? '',
  commission:
    p.commissionValue === null
      ? ''
      : String(p.commissionKind === 'flat' ? p.commissionValue / 100 : p.commissionValue),
});

function useCodeRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin-promo-codes'] });
  };
}

type Phase = 'running' | 'scheduled' | 'ended' | 'used up' | 'draft';
function phase(p: AdminPromoCodeDto): Phase {
  if (p.status === 'draft') return 'draft';
  if (p.running) return 'running';
  if (p.endsAt && new Date(p.endsAt) <= new Date()) return 'ended';
  if (new Date(p.startsAt) > new Date()) return 'scheduled';
  return p.maxUses !== null && p.uses >= p.maxUses ? 'used up' : 'ended';
}

const PHASE_STYLE: Record<Phase, string> = {
  running: 'bg-mist text-on-mist',
  scheduled: 'bg-marigold-soft text-marigold-text',
  ended: 'bg-sunk text-ink2',
  'used up': 'bg-sunk text-ink2',
  draft: 'bg-sunk text-ink2',
};

const chip = (on: boolean) =>
  `h-9 rounded-full px-3.5 text-[13px] font-semibold border cursor-pointer ${
    on ? 'bg-brand text-white border-brand' : 'border-line text-ink2 hover:text-ink'
  }`;

function CodeForm({
  initial,
  courses,
  bundles,
  onDone,
}: { initial: Form; courses: AdminCourseDto[]; bundles: AdminBundleDto[]; onDone: () => void }) {
  const refresh = useCodeRefresh();
  const [f, setF] = useState<Form>(initial);
  const amount = Number(f.amount);
  const code = f.code.trim().toUpperCase();
  const amountOk = f.kind === 'percent' ? amount >= 1 && amount <= 90 : amount >= 1 && amount <= 50_000;
  const datesOk = !!f.starts && (f.noEnd || (!!f.ends && new Date(f.ends) > new Date(f.starts)));
  const maxOk = f.maxUses === '' || Number(f.maxUses) >= 1;
  const creator = f.creatorName.trim().replace(/\s+/g, ' ');
  const commission = Number(f.commission);
  const commissionOk =
    f.commissionKind === '' ||
    (creator.length >= 2 &&
      f.commission !== '' &&
      (f.commissionKind === 'percent'
        ? Number.isInteger(commission) && commission >= 1 && commission <= 100
        : commission >= 0 && commission <= 50_000));
  const ok =
    commissionOk &&
    (creator === '' || creator.length >= 2) &&
    CODE_RE.test(code) &&
    Number.isInteger(amount) &&
    amountOk &&
    datesOk &&
    maxOk &&
    (f.appliesTo !== 'chosen' || f.courseIds.length + f.bundleIds.length > 0);
  const save = useMutation({
    mutationFn: (status: 'draft' | 'live') =>
      api.adminSavePromoCode({
        ...(f.id ? { id: f.id } : {}),
        code,
        kind: f.kind,
        percentOff: f.kind === 'percent' ? amount : null,
        amountOffPaise: f.kind === 'flat' ? amount * 100 : null,
        appliesTo: f.appliesTo,
        courseIds: f.appliesTo === 'chosen' ? f.courseIds : [],
        bundleIds: f.appliesTo === 'chosen' ? f.bundleIds : [],
        startsAt: iso(f.starts),
        endsAt: f.noEnd ? null : iso(f.ends),
        status,
        maxUses: f.maxUses === '' ? null : Number(f.maxUses),
        oncePerStudent: f.oncePerStudent,
        newStudentsOnly: f.newStudentsOnly,
        creatorName: creator || null,
        creatorContact: creator ? f.creatorContact.trim() || null : null,
        commissionKind: creator && f.commissionKind ? f.commissionKind : null,
        commissionValue:
          creator && f.commissionKind
            ? f.commissionKind === 'flat'
              ? Math.round(commission * 100)
              : commission
            : null,
      }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const toggle = (key: 'courseIds' | 'bundleIds', id: string) =>
    setF((x) => ({ ...x, [key]: x[key].includes(id) ? x[key].filter((v) => v !== id) : [...x[key], id] }));
  const example = courses.find((c) => c.status === 'live');

  return (
    <div className="rounded-[22px] border-2 border-marigold bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-3">
        <Field label="Code students type">
          <input
            className={`${input} font-mono uppercase`}
            value={f.code}
            maxLength={24}
            placeholder="DIWALI20"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
          />
        </Field>
        <Field label="Discount type">
          <div className="flex gap-2" role="radiogroup" aria-label="Discount type">
            {(
              [
                ['percent', '% off'],
                ['flat', '₹ off'],
              ] as const
            ).map(([kind, text]) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={f.kind === kind}
                onClick={() => setF({ ...f, kind })}
                className={chip(f.kind === kind)}
              >
                {text}
              </button>
            ))}
          </div>
        </Field>
        <Field label={f.kind === 'percent' ? 'Percent off' : 'Rupees off'}>
          <input
            className={`${input} font-mono`}
            value={f.amount}
            inputMode="numeric"
            maxLength={f.kind === 'percent' ? 2 : 5}
            onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })}
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
            disabled={f.noEnd}
            onChange={(e) => setF({ ...f, ends: e.target.value })}
          />
        </Field>
        <Field label="Total uses (blank = no limit)">
          <input
            className={`${input} font-mono`}
            value={f.maxUses}
            inputMode="numeric"
            maxLength={7}
            placeholder="No limit"
            onChange={(e) => setF({ ...f, maxUses: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={f.noEnd}
            onChange={(e) => setF({ ...f, noEnd: e.target.checked })}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          No end date
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={f.oncePerStudent}
            onChange={(e) => setF({ ...f, oncePerStudent: e.target.checked })}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          Each student can use it once
        </label>
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={f.newStudentsOnly}
            onChange={(e) => setF({ ...f, newStudentsOnly: e.target.checked })}
            className="w-5 h-5 accent-[var(--teal)]"
          />
          New students only (first purchase)
        </label>
      </div>
      {example && amountOk && (
        <p className="m-0 text-sm text-ink2">
          A {formatRupees(example.pricePaise)} course costs{' '}
          <strong className="text-ink">{formatRupees(codePrice(example.pricePaise, f.kind, amount))}</strong>{' '}
          with this code. During an offer the code comes off the offer price. Prices never go below ₹1.
        </p>
      )}

      <fieldset className="m-0 p-4 rounded-2xl border border-line flex flex-col gap-3">
        <legend className="px-1 font-semibold">Where it works</legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Where the code works">
          {APPLIES.map(([appliesTo, text]) => (
            <button
              key={appliesTo}
              type="button"
              role="radio"
              aria-checked={f.appliesTo === appliesTo}
              onClick={() => setF({ ...f, appliesTo })}
              className={chip(f.appliesTo === appliesTo)}
            >
              {text}
            </button>
          ))}
        </div>
        {f.appliesTo !== 'chosen' ? (
          <p className="m-0 text-sm text-ink2">{APPLIES.find(([a]) => a === f.appliesTo)?.[2]}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <CoursePicker
              courses={courses}
              value={f.courseIds}
              onToggle={(id) => toggle('courseIds', id)}
              label="the promo code"
            />
            <BundlePicker bundles={bundles} value={f.bundleIds} onToggle={(id) => toggle('bundleIds', id)} />
          </div>
        )}
      </fieldset>

      <fieldset className="m-0 p-4 rounded-2xl border border-line flex flex-col gap-3">
        <legend className="px-1 font-semibold">Creator (optional)</legend>
        <p className="m-0 text-sm text-ink2">
          If the code belongs to someone who shares it (a campus ambassador, a YouTuber), name them and set
          their cut. What they earn and what you still owe them shows in Money › Discounts.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1.4fr_1fr_0.8fr] gap-3">
          <Field label="Creator's name">
            <input
              className={input}
              maxLength={80}
              placeholder="Rahul Sharma"
              value={f.creatorName}
              onChange={(e) => setF({ ...f, creatorName: e.target.value })}
            />
          </Field>
          <Field label="Phone, email or UPI (optional)">
            <input
              className={input}
              maxLength={120}
              disabled={!creator}
              value={f.creatorContact}
              onChange={(e) => setF({ ...f, creatorContact: e.target.value })}
            />
          </Field>
          <Field label="Their commission">
            <select
              className={input}
              disabled={!creator}
              value={f.commissionKind}
              onChange={(e) => setF({ ...f, commissionKind: e.target.value as Form['commissionKind'] })}
            >
              <option value="">None</option>
              <option value="percent">% of what the student pays</option>
              <option value="flat">₹ per use</option>
            </select>
          </Field>
          <Field label={f.commissionKind === 'flat' ? 'Rupees per use' : 'Percent'}>
            <input
              className={`${input} font-mono`}
              inputMode="decimal"
              disabled={!creator || !f.commissionKind}
              value={f.commission}
              onChange={(e) => setF({ ...f, commission: e.target.value.replace(/[^\d.]/g, '') })}
            />
          </Field>
        </div>
        {creator && f.commissionKind && example && commissionOk && amountOk && (
          <p className="m-0 text-sm text-ink2">
            On a {formatRupees(codePrice(example.pricePaise, f.kind, amount))} order with this code, {creator}{' '}
            earns{' '}
            <strong className="text-ink">
              {formatMoney(
                f.commissionKind === 'percent'
                  ? Math.floor((codePrice(example.pricePaise, f.kind, amount) * commission) / 100)
                  : Math.min(codePrice(example.pricePaise, f.kind, amount), Math.round(commission * 100)),
              )}
            </strong>
            . Rates are locked in per order, so changing them later only affects new orders.
          </p>
        )}
        {creator !== '' && creator.length < 2 && (
          <p className="m-0 text-sm text-blush-text">The creator's name needs at least 2 letters.</p>
        )}
        {f.commissionKind === 'percent' && f.commission !== '' && !commissionOk && (
          <p className="m-0 text-sm text-blush-text">A commission percent is a whole number from 1 to 100.</p>
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
        {f.code && !CODE_RE.test(code) && (
          <span className="text-sm text-blush-text">
            Use 3 to 24 letters, numbers, - or _ (no spaces), like DIWALI20.
          </span>
        )}
        {!f.noEnd && f.ends && f.starts && new Date(f.ends) <= new Date(f.starts) && (
          <span className="text-sm text-blush-text">The code has to end after it starts.</span>
        )}
      </div>
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
    </div>
  );
}

function CodeRow({ p, onEdit }: { p: AdminPromoCodeDto; onEdit: () => void }) {
  const refresh = useCodeRefresh();
  const [confirm, setConfirm] = useState(false);
  const ph = phase(p);
  const change = useMutation({
    mutationFn: (patch: Partial<{ status: 'draft' | 'live'; endsAt: string }>) =>
      api.adminSavePromoCode({
        id: p.id,
        code: p.code,
        kind: p.kind,
        percentOff: p.percentOff,
        amountOffPaise: p.amountOffPaise,
        appliesTo: p.appliesTo,
        courseIds: p.courseIds,
        bundleIds: p.bundleIds,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        status: p.status,
        maxUses: p.maxUses,
        oncePerStudent: p.oncePerStudent,
        newStudentsOnly: p.newStudentsOnly,
        creatorName: p.creatorName,
        creatorContact: p.creatorContact,
        commissionKind: p.commissionKind,
        commissionValue: p.commissionValue,
        ...patch,
      }),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: () => api.adminDeletePromoCode(p.id), onSuccess: refresh });
  const where =
    p.appliesTo === 'everything'
      ? 'Everything'
      : p.appliesTo === 'courses'
        ? 'All courses'
        : p.appliesTo === 'bundles'
          ? 'All bundles'
          : [
              p.courseIds.length ? plural(p.courseIds.length, 'course') : '',
              p.bundleIds.length ? plural(p.bundleIds.length, 'bundle') : '',
            ]
              .filter(Boolean)
              .join(' · ');
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={`inline-flex items-center h-6 px-2.5 rounded-md text-[12px] font-semibold capitalize ${PHASE_STYLE[ph]}`}
        >
          {ph}
        </span>
        <div className="flex-[1_1_260px] min-w-0">
          <div className="font-semibold">
            <span className="font-mono">{p.code}</span>{' '}
            <span className="text-teal-text">· {offLabel(p)}</span>
          </div>
          <div className="font-mono text-xs text-ink2">
            {when(p.startsAt)} to {p.endsAt ? when(p.endsAt) : 'no end date'}
          </div>
          <div className="text-[13px] text-ink2">
            {where} · {p.uses}
            {p.maxUses !== null ? ` of ${p.maxUses}` : ''} used
            {p.uses > 0 ? ` · ${formatRupees(p.discountGivenPaise)} off given` : ''}
            {p.oncePerStudent ? ' · once per student' : ''}
            {p.newStudentsOnly ? ' · first purchase only' : ''}
          </div>
          {p.creatorName && (
            <div className="text-[13px] text-ink2">
              For <strong className="text-ink">{p.creatorName}</strong>
              {p.commissionKind
                ? ` · ${p.commissionKind === 'percent' ? `${p.commissionValue}% of each sale` : `${formatMoney(p.commissionValue ?? 0)} per use`} · earned ${formatMoney(p.earnedPaise)}`
                : ' · no commission'}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {ph === 'running' && (
            <Button
              variant="outline"
              size="sm"
              disabled={change.isPending}
              onClick={() => change.mutate({ status: 'draft' })}
            >
              Switch off
            </Button>
          )}
          {p.status === 'draft' && (
            <Button size="sm" disabled={change.isPending} onClick={() => change.mutate({ status: 'live' })}>
              Switch on
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
            Delete
          </Button>
        </div>
      </div>
      {change.isError && <p className="m-0 text-sm text-blush-text">{friendly(change.error)}</p>}
      {p.uses > 0 && (
        <UsedBy
          queryKey={['admin-promo-orders', p.id]}
          load={() => api.adminPromoOrders(p.id)}
          count={p.uses}
          csvName={`promo-${p.code}`}
        />
      )}
      {confirm && (
        <Sheet open onOpenChange={(v) => !v && setConfirm(false)} title={`Delete ${p.code}?`}>
          <p className="m-0 text-[15px]">
            Students can't use it any more. Orders already paid keep what they paid. To pause it instead,
            switch it off.
          </p>
          {del.isError && <p className="m-0 text-sm text-blush-text">{friendly(del.error)}</p>}
          <div className="flex gap-2">
            <Button variant="ink" disabled={del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? 'Deleting…' : 'Delete code'}
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

type Show = 'all' | 'creators' | 'other';

/**
 * Each creator at a glance: their codes, paid uses and what they have earned. What is paid and
 * still owed lives in Money › Discounts; this is the quick look while making codes.
 */
function CreatorSummary({ codes }: { codes: AdminPromoCodeDto[] }) {
  const byCreator = new Map<string, { name: string; codes: string[]; uses: number; earned: number }>();
  for (const p of codes) {
    if (!p.creatorName) continue;
    const key = p.creatorName.toLowerCase();
    const row = byCreator.get(key) ?? { name: p.creatorName, codes: [], uses: 0, earned: 0 };
    row.codes.push(p.code);
    row.uses += p.uses;
    row.earned += p.earnedPaise;
    byCreator.set(key, row);
  }
  const rows = [...byCreator.values()].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  if (rows.length === 0) return null;
  return (
    <section aria-label="Creators" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 font-semibold">Creators</h3>
        <span className="text-[13px] text-ink2">Payments and what's owed: Money › Discounts</span>
      </div>
      <div role="list" className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
        {rows.map((r) => (
          <div
            role="listitem"
            key={r.name}
            className="rounded-2xl border border-line bg-surface px-4 py-3 flex flex-col gap-1"
          >
            <span className="font-semibold truncate">{r.name}</span>
            <span className="font-mono text-[12px] text-ink2 truncate">{r.codes.join(' · ')}</span>
            <span className="flex items-baseline justify-between gap-2 text-[13.5px]">
              <span className="text-ink2">
                <b className="text-ink tabular-nums">{r.uses}</b> paid {r.uses === 1 ? 'use' : 'uses'}
              </span>
              <span className="text-ink2">
                earned <b className="text-teal-text tabular-nums">{formatMoney(r.earned)}</b>
              </span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Promo codes: a code students type at checkout for a percentage or a flat amount off. Prices on
 * courses and bundles are never edited; a student without a code pays the normal price.
 */
export function PromoCodesPanel() {
  const codes = useQuery({ queryKey: ['admin-promo-codes'], queryFn: api.adminPromoCodes });
  const courses = useQuery({ queryKey: ['admin-courses'], queryFn: api.adminCourses });
  const bundles = useQuery({ queryKey: ['admin-bundles'], queryFn: api.adminBundles });
  const [editing, setEditing] = useState<Form | null>(null);
  const [show, setShow] = useState<Show>('all');
  const all = codes.data ?? [];
  const hasCreators = all.some((p) => p.creatorName);
  const shown = all.filter((p) => show === 'all' || (show === 'creators') === !!p.creatorName);
  const liveBundles = (bundles.data ?? []).filter((b) => b.status === 'live');

  return (
    <Panel
      title="Promo codes"
      aside={
        !editing && (
          <Button variant="buy" onClick={() => setEditing(newCode())}>
            New code
          </Button>
        )
      }
    >
      <p className="m-0 text-sm text-ink2 max-w-[760px]">
        A code like DIWALI20 that students type on the check-out slip, after Buy and before paying. Give a
        code to a creator (a campus ambassador, a YouTuber) to see every sale it brings and what they earn;
        students see "shared by" their name. Only paid orders count as a use.
      </p>
      {editing && courses.data && (
        <CodeForm
          key={editing.id ?? 'new'}
          initial={editing}
          courses={courses.data}
          bundles={liveBundles}
          onDone={() => setEditing(null)}
        />
      )}
      {codes.isLoading ? (
        <Skeleton className="h-32" />
      ) : codes.isError && !codes.data ? (
        <ErrorState
          title="Promo codes didn't load."
          message={friendly(codes.error)}
          onRetry={() => codes.refetch()}
        />
      ) : (
        <>
          <CreatorSummary codes={all} />
          {hasCreators && (
            <div role="radiogroup" aria-label="Show codes" className="flex flex-wrap gap-1.5">
              {(
                [
                  ['all', `All · ${all.length}`],
                  ['creators', `Creator codes · ${all.filter((p) => p.creatorName).length}`],
                  ['other', `Other codes · ${all.filter((p) => !p.creatorName).length}`],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={show === value}
                  onClick={() => setShow(value)}
                  className={`press h-8 px-3.5 rounded-full text-[13px] font-semibold cursor-pointer border-[1.5px] ${
                    show === value
                      ? 'bg-ink text-bg border-ink'
                      : 'bg-transparent text-ink border-line hover:border-ink2'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
            {shown.map((p) => (
              <CodeRow key={p.id} p={p} onEdit={() => setEditing(toForm(p))} />
            ))}
            {all.length === 0 && <li className="text-ink2">No promo codes yet.</li>}
          </ul>
        </>
      )}
    </Panel>
  );
}
