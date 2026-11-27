import { useState } from 'react';
import { Button } from '../../../../shared/ui/button';
import { ChevronDown, Minus, Plus, Trash } from '../../../../shared/ui/icons';
import { field } from '../../core/ui';
import type { Exam, PlanStatus, PlanSubject, SubjectPlan } from '../planner';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STATUS_TONE: Record<PlanStatus, string> = {
  safe: 'bg-mist text-on-mist',
  recover: 'bg-marigold-soft text-marigold-text',
  risk: 'bg-blush text-blush-text',
  empty: 'bg-sunk text-ink2',
  invalid: 'bg-blush text-blush-text',
};

const unit = (s: PlanSubject, n: number) =>
  s.kind === 'lab' ? `lab session${n === 1 ? '' : 's'}` : `class${n === 1 ? '' : 'es'}`;

/** The one sentence that answers "what do I do?" for this subject and exam. */
export function verdict(p: SubjectPlan, exam: Exam): string {
  const s = p.subject;
  const left = p.remainingSessions;
  if (p.status === 'invalid') return 'Attended can’t be more than held. Check the numbers.';
  if (p.status === 'empty') return 'Type classes held and attended from VTOP to see your plan.';
  if (p.status === 'risk')
    return left > 0
      ? `Even attending all ${left} ${unit(s, left)} left, you can’t get above 75% before ${exam.name}.`
      : `Below 75% for ${exam.name}.`;
  if (p.status === 'recover')
    return p.mustAttend === left
      ? `Attend all ${left} ${unit(s, left)} left to get above 75%.`
      : `Attend ${p.mustAttend} of the next ${left} ${unit(s, left)} to get above 75%.`;
  if (left === 0) return `Above 75% for ${exam.name}.`;
  return p.canSkip === 0
    ? `Attend all ${left} ${unit(s, left)} left: skipping even one drops you to 75% or below.`
    : `You can skip ${p.canSkip} of the next ${left} ${unit(s, left)}.`;
}

function CountInput({
  label,
  value,
  onChange,
}: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink2 min-w-0">
      {label}
      <input
        className={`${field} h-10 text-center font-mono tabular-nums`}
        type="number"
        inputMode="numeric"
        min={0}
        max={9999}
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 0);
        }}
      />
    </label>
  );
}

export function PlanSubjectRow({
  plan,
  exam,
  windowLabel,
  onCounts,
  onRecord,
  onChange,
  onRemove,
}: {
  plan: SubjectPlan;
  exam: Exam;
  /** "since the semester start" / "since Tue 1 Dec". */
  windowLabel: string;
  onCounts: (c: { attended: number; held: number }) => void;
  onRecord: (attended: boolean) => void;
  onChange: (s: PlanSubject) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const s = plan.subject;
  const known = plan.status !== 'empty' && plan.status !== 'invalid';
  return (
    <li className="flex flex-col gap-3 border-b border-line py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="m-0 text-[17px] font-bold leading-snug [overflow-wrap:anywhere]">{s.name}</p>
          {s.kind === 'lab' && (
            <p className="m-0 text-[12px] text-ink2">
              Lab · one session counts as {s.labWeight} class{s.labWeight === 1 ? '' : 'es'}
            </p>
          )}
        </div>
        <span
          className={`flex-none rounded-lg px-2.5 py-1 font-mono text-[15px] font-semibold tabular-nums ${STATUS_TONE[plan.status]}`}
        >
          {plan.now === null ? '––' : `${plan.now}%`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-[340px]">
        <CountInput
          label="Attended"
          value={plan.counts.attended}
          onChange={(attended) => onCounts({ ...plan.counts, attended })}
        />
        <CountInput
          label="Held"
          value={plan.counts.held}
          onChange={(held) => onCounts({ ...plan.counts, held })}
        />
      </div>
      <p className="m-0 -mt-1 text-[12px] text-ink2">Counted {windowLabel}.</p>

      <p
        className={`m-0 text-[15px] font-semibold leading-snug ${plan.status === 'risk' || plan.status === 'invalid' ? 'text-blush-text' : 'text-ink'}`}
      >
        {verdict(plan, exam)}
      </p>
      {known && (
        <p className="m-0 text-[13px] text-ink2 tabular-nums">
          {plan.ifAll !== null && plan.remaining > 0 && <>Attend all: {plan.ifAll}% · </>}
          Marks {plan.marks} of 5
          {plan.ifSkipNext !== null && <> · Skip the next one: {plan.ifSkipNext}% now</>}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onRecord(true)}>
          <Plus size={14} /> Attended
        </Button>
        <Button variant="outline" size="sm" onClick={() => onRecord(false)}>
          <Minus size={14} /> Missed
        </Button>
        <button
          type="button"
          aria-expanded={editing}
          onClick={() => setEditing((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 h-9 px-2 text-[13px] font-semibold text-ink2 hover:text-ink"
        >
          Edit
          <ChevronDown size={14} className={`transition-transform ${editing ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {editing && (
        <div className="flex flex-col gap-3 rounded-2xl bg-sunk p-4">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2">
            Name
            <input
              className={field}
              value={s.name}
              maxLength={80}
              onChange={(e) => onChange({ ...s, name: e.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            {(['theory', 'lab'] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={s.kind === k}
                onClick={() => onChange({ ...s, kind: k })}
                className={`h-9 rounded-full px-4 font-semibold border-[1.5px] ${s.kind === k ? 'bg-ink text-bg border-ink' : 'border-line text-ink'}`}
              >
                {k === 'theory' ? 'Theory' : 'Lab'}
              </button>
            ))}
            {s.kind === 'lab' && (
              <label className="inline-flex items-center gap-2 ml-1 text-ink2">
                One session counts as
                <select
                  className="h-9 rounded-lg bg-surface border-[1.5px] border-line px-2 text-ink"
                  value={s.labWeight}
                  onChange={(e) => onChange({ ...s, labWeight: e.target.value === '2' ? 2 : 1 })}
                >
                  <option value="1">1 class</option>
                  <option value="2">2 classes</option>
                </select>
              </label>
            )}
          </div>
          <div>
            <p className="m-0 mb-2 text-sm font-semibold text-ink2">
              {s.kind === 'lab' ? 'Lab sessions' : 'Classes'} each week
            </p>
            <div className="grid grid-cols-6 gap-1.5 max-w-[420px]">
              {DAYS.map((d, i) => (
                <div key={d} className="flex flex-col items-center gap-1">
                  <span className="text-[11px] font-semibold text-ink2">{d}</span>
                  <button
                    type="button"
                    aria-label={`${d}: ${s.weekly[i]} — tap to change`}
                    onClick={() => {
                      const weekly = [...s.weekly] as PlanSubject['weekly'];
                      weekly[i] = (weekly[i]! + 1) % 4;
                      onChange({ ...s, weekly });
                    }}
                    className={`h-10 w-full rounded-xl font-mono text-[15px] font-semibold tabular-nums ${s.weekly[i] ? 'bg-brand text-white' : 'bg-surface text-ink2 shadow-[0_0_0_1px_var(--line)]'}`}
                  >
                    {s.weekly[i]}
                  </button>
                </div>
              ))}
            </div>
            <p className="m-0 mt-1.5 text-[12px] text-ink2">Tap a day to change it (0–3).</p>
          </div>
          <Button variant="ghost" size="sm" className="self-start -ml-2 text-blush-text" onClick={onRemove}>
            <Trash size={14} /> Remove subject
          </Button>
        </div>
      )}
    </li>
  );
}
