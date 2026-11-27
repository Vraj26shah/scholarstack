import type { FeeMode, FeeStatementDto, LedgerEntryDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { FeeStatement, money, monthName, ruleText } from '../fees/fee-statement';
import { Panel } from './ui';

const input =
  'h-10 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal';
const label = 'flex flex-col gap-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink2';
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const toPaise = (v: string) => Math.round(Number(v) * 100);

/** Sets a restaurant's fee from a day on (never in the past: accepted orders keep theirs). */
function RuleForm({ slug, onSaved }: { slug: string; onSaved: (s: FeeStatementDto) => void }) {
  const [mode, setMode] = useState<FeeMode>('per_order');
  const [perOrder, setPerOrder] = useState('5');
  const [percent, setPercent] = useState('0');
  const [tiffinFee, setTiffinFee] = useState('0');
  const [monthly, setMonthly] = useState('499');
  const [freeUntil, setFreeUntil] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.adminSetFeeRule(slug, {
        mode,
        perOrder: Number(perOrder) || 0,
        percent: Number(percent) || 0,
        tiffinFee: Number(tiffinFee) || 0,
        monthly: Number(monthly) || 0,
        freeUntil,
        startsOn,
        note,
      }),
    onSuccess: onSaved,
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex flex-wrap gap-1">
        {(
          [
            ['per_order', 'Per order'],
            ['monthly', 'Monthly'],
            ['none', 'No fee'],
          ] as const
        ).map(([k, l]) => (
          <Button key={k} size="sm" variant={mode === k ? 'ink' : 'ghost'} onClick={() => setMode(k)}>
            {l}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        {mode === 'per_order' && (
          <>
            <label className={label}>
              ₹ per order
              <input
                className={`${input} w-28`}
                inputMode="numeric"
                value={perOrder}
                onChange={(e) => setPerOrder(e.target.value)}
              />
            </label>
            <label className={label}>
              % of the bill
              <input
                className={`${input} w-28`}
                inputMode="decimal"
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
              />
            </label>
            <label className={label}>
              ₹ per tiffin plan
              <input
                className={`${input} w-32`}
                inputMode="numeric"
                value={tiffinFee}
                onChange={(e) => setTiffinFee(e.target.value)}
              />
            </label>
          </>
        )}
        {mode === 'monthly' && (
          <label className={label}>
            ₹ a month
            <input
              className={`${input} w-32`}
              inputMode="numeric"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
            />
          </label>
        )}
        <label className={label}>
          Free until (optional)
          <input
            type="date"
            className={input}
            value={freeUntil}
            onChange={(e) => setFreeUntil(e.target.value)}
          />
        </label>
        <label className={label}>
          Starts on
          <input
            type="date"
            min={today()}
            className={input}
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
        </label>
      </div>
      <input
        className={input}
        maxLength={300}
        placeholder="Note (what you agreed with the owner)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <p className="m-0 text-[13px] text-ink2">
        Applies to orders accepted from the start day (today if blank). Orders already accepted keep their
        fee. A monthly plan is charged by the day when each month ends.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ink" size="sm" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save the fee'}
        </Button>
        {save.error && (
          <span role="alert" className="text-[13px] text-blush-text">
            {friendly(save.error)}
          </span>
        )}
      </div>
    </form>
  );
}

/** A payment received from the restaurant, or an adjustment (+ charge, − credit). */
function EntryForm({ slug, onSaved }: { slug: string; onSaved: (s: FeeStatementDto) => void }) {
  const [kind, setKind] = useState<'payment' | 'adjust'>('payment');
  const [amount, setAmount] = useState('');
  const [day, setDay] = useState('');
  const [method, setMethod] = useState('UPI');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.adminFeeEntry(slug, {
        kind,
        amount: toPaise(amount),
        day,
        method: kind === 'payment' ? method : '',
        note,
      }),
    onSuccess: (s) => {
      setAmount('');
      setNote('');
      onSaved(s);
    },
  });
  const valid = Number.isFinite(Number(amount)) && toPaise(amount) !== 0 && note.trim().length >= 3;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant={kind === 'payment' ? 'ink' : 'ghost'} onClick={() => setKind('payment')}>
          Payment received
        </Button>
        <Button size="sm" variant={kind === 'adjust' ? 'ink' : 'ghost'} onClick={() => setKind('adjust')}>
          Adjustment
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={label}>
          {kind === 'payment' ? 'Amount ₹' : 'Amount ₹ (+ charge, − credit)'}
          <input
            className={`${input} w-40`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {kind === 'payment' && (
          <label className={label}>
            How
            <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
              {['UPI', 'Cash', 'Bank transfer', 'Other'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        )}
        <label className={label}>
          Day
          <input
            type="date"
            max={today()}
            className={input}
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
      </div>
      <input
        className={input}
        maxLength={300}
        placeholder="Note (required): UTR number, reason…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="ink" size="sm" disabled={!valid || save.isPending}>
          {save.isPending ? 'Saving…' : kind === 'payment' ? 'Record payment' : 'Add adjustment'}
        </Button>
        {save.error && (
          <span role="alert" className="text-[13px] text-blush-text">
            {friendly(save.error)}
          </span>
        )}
      </div>
    </form>
  );
}

function Waive({
  slug,
  e,
  onSaved,
}: { slug: string; e: LedgerEntryDto; onSaved: (s: FeeStatementDto) => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.adminWaiveFee(slug, e.order!.id, !e.waived, note),
    onSuccess: (s) => {
      setAsking(false);
      onSaved(s);
    },
  });
  if (e.kind !== 'order' || !e.order || e.amount <= 0) return null;
  if (!asking)
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="border-0 bg-transparent p-0 text-[13px] font-semibold text-ink2 underline underline-offset-4 cursor-pointer"
      >
        {e.waived ? 'Undo waiver' : 'Waive'}
      </button>
    );
  return (
    <form
      className="basis-full flex flex-wrap items-center gap-2 pl-[72px]"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (note.trim().length >= 3) m.mutate();
      }}
    >
      <input
        className={`${input} flex-1 min-w-[200px]`}
        maxLength={300}
        placeholder="Why (required)"
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
      />
      <Button type="submit" size="sm" variant="ink" disabled={note.trim().length < 3 || m.isPending}>
        {e.waived ? 'Undo waiver' : 'Waive fee'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>
        Back
      </Button>
      {m.error && (
        <span role="alert" className="text-[13px] text-blush-text">
          {friendly(m.error)}
        </span>
      )}
    </form>
  );
}

function Account({ slug, onBack }: { slug: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [period, setPeriod] = useState('');
  const key = ['admin-fee-statement', slug, period];
  const q = useQuery({ queryKey: key, queryFn: () => api.adminFeeStatement(slug, period) });
  const [tool, setTool] = useState<'' | 'rule' | 'entry'>('');
  const [closeNote, setCloseNote] = useState('');
  const saved = (s: FeeStatementDto) => {
    qc.setQueryData(['admin-fee-statement', slug, period], s);
    void qc.invalidateQueries({ queryKey: ['admin-fee-statement', slug] });
    void qc.invalidateQueries({ queryKey: ['admin-fees'] });
  };
  const close = useMutation({
    mutationFn: () => api.adminCloseFeeMonth(slug, q.data!.period, closeNote),
    onSuccess: saved,
  });
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError || !q.data)
    return (
      <ErrorState title="Couldn't load the account" message={friendly(q.error)} onRetry={() => q.refetch()} />
    );
  const s = q.data;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onBack}>
          ← All restaurants
        </Button>
        <h3 className="m-0 font-display text-[24px] font-bold text-ink">{s.messName}</h3>
        <div className="flex gap-1 sm:ml-auto">
          <Button
            size="sm"
            variant={tool === 'entry' ? 'ink' : 'outline'}
            onClick={() => setTool(tool === 'entry' ? '' : 'entry')}
          >
            Payment / adjustment
          </Button>
          <Button
            size="sm"
            variant={tool === 'rule' ? 'ink' : 'outline'}
            onClick={() => setTool(tool === 'rule' ? '' : 'rule')}
          >
            Change fee
          </Button>
        </div>
      </div>
      {tool === 'rule' && (
        <RuleForm
          slug={slug}
          onSaved={(x) => {
            saved(x);
            setTool('');
          }}
        />
      )}
      {tool === 'entry' && <EntryForm slug={slug} onSaved={saved} />}
      {s.unclosed.length > 0 && (
        <p className="m-0 text-[14px] text-marigold-text font-semibold">
          Not closed yet: {s.unclosed.map(monthName).join(', ')}. Close them in order once you've checked them
          with the owner.
        </p>
      )}
      {s.canClose && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${input} flex-1 min-w-[220px]`}
            maxLength={300}
            placeholder={`Note for ${monthName(s.period)} (optional)`}
            value={closeNote}
            onChange={(e) => setCloseNote(e.target.value)}
          />
          <Button size="sm" variant="ink" disabled={close.isPending} onClick={() => close.mutate()}>
            Close {monthName(s.period)} at {money(s.closing)}
          </Button>
          {close.error && (
            <span role="alert" className="text-[13px] text-blush-text">
              {friendly(close.error)}
            </span>
          )}
        </div>
      )}
      <FeeStatement
        s={s}
        period={s.period}
        onPeriod={setPeriod}
        entryAction={(e) => <Waive slug={slug} e={e} onSaved={saved} />}
      />
      {s.rules.length > 1 && (
        <section className="flex flex-col">
          <h2 className="m-0 border-b-2 border-ink pb-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink">
            Fee history
          </h2>
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {s.rules.map((r) => (
              <li key={r.id} className="py-2 text-[14px] text-ink">
                From {r.startsOn}: <strong>{ruleText(r)}</strong>
                <span className="text-ink2">
                  {r.note ? ` · “${r.note}”` : ''} · set by {r.createdBy}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Admin › Campus › Restaurant fees: what each restaurant owes, its fee, and its account. Fees are
 * written when an order is accepted; payments and corrections are added here; months are closed
 * once checked. Nothing is ever edited or deleted.
 */
export function FeesPanel() {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['admin-fees'], queryFn: api.adminFees });
  return (
    <Panel title="Restaurant fees">
      {open ? (
        <Account slug={open} onBack={() => setOpen(null)} />
      ) : q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load fees" message={friendly(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="m-0 text-ink2">No restaurants yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[14px] text-ink2">
            Total owed now:{' '}
            <strong className="text-ink tabular-nums">
              {money(q.data.reduce((n, r) => n + Math.max(0, r.balanceNow), 0))}
            </strong>
          </p>
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.slug}>
                <button
                  type="button"
                  onClick={() => setOpen(r.slug)}
                  className="w-full flex flex-wrap items-baseline gap-x-5 gap-y-1 py-3 text-left border-0 bg-transparent cursor-pointer"
                >
                  <span className="flex-1 min-w-[200px]">
                    <strong className="block text-[15.5px] text-ink">{r.name}</strong>
                    <span className="block text-[13px] text-ink2">
                      {ruleText(r.rule)} · this month {r.thisMonth.orders} orders, ₹
                      {r.thisMonth.sales.toLocaleString('en-IN')} sales, fees {money(r.thisMonth.fees)}
                      {r.unclosed.length
                        ? ` · ${r.unclosed.length} month${r.unclosed.length === 1 ? '' : 's'} to close`
                        : ''}
                    </span>
                  </span>
                  <span
                    className={`tabular-nums text-[18px] font-extrabold ${r.balanceNow > 0 ? 'text-ink' : 'text-teal-text'}`}
                  >
                    {r.balanceNow > 0 ? money(r.balanceNow) : 'Settled'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
