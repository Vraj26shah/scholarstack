import { useState } from 'react';
import { Button } from '../../../../shared/ui/button';
import { Cross, Plus } from '../../../../shared/ui/icons';
import { newId } from '../../core/storage';
import { Labelled, ToolCard, field } from '../../core/ui';
import { type Exam, type PlannerState, RULE_TEXT, isDay, shortDay } from '../planner';

type Update = (fn: (s: PlannerState) => PlannerState) => void;

/** The dates that decide every number: semester start, each exam and its counting window, holidays. */
export function SemesterSetup({ state, update }: { state: PlannerState; update: Update }) {
  const ready = state.exams.some((e) => isDay(e.date));
  const [open, setOpen] = useState(!ready);

  const setExam = (id: string, patch: Partial<Exam>) =>
    update((s) => ({ ...s, exams: s.exams.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  if (!open)
    return (
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2 border-b border-line pb-4">
        <p className="m-0 flex-1 min-w-[220px] text-[15px] text-ink2">
          {state.semesterStart && <>Semester from {shortDay(state.semesterStart)} · </>}
          {state.exams.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ' · '}
              <span className="font-semibold text-ink">{e.name}</span> {shortDay(e.date) || 'no date'}
            </span>
          ))}
          {state.holidays.length > 0 && (
            <>
              {' '}
              · {state.holidays.length} holiday{state.holidays.length === 1 ? '' : 's'}
            </>
          )}
        </p>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Edit dates
        </Button>
      </div>
    );

  return (
    <ToolCard title="Your semester">
      <p className="m-0 text-[14px] leading-relaxed text-ink2">
        Dates change every semester, so type them from your academic calendar. Classes are counted up to the
        day before each exam.
      </p>
      <Labelled label="Semester started" className="sm:max-w-[260px]">
        <input
          type="date"
          className={field}
          value={state.semesterStart}
          onChange={(e) => update((s) => ({ ...s, semesterStart: e.target.value }))}
        />
      </Labelled>

      <ul className="m-0 p-0 list-none flex flex-col gap-4">
        {state.exams.map((exam) => (
          <ExamRow
            key={exam.id}
            exam={exam}
            semesterStart={state.semesterStart}
            canRemove={state.exams.length > 1}
            onChange={(patch) => setExam(exam.id, patch)}
            onRemove={() => update((s) => ({ ...s, exams: s.exams.filter((e) => e.id !== exam.id) }))}
          />
        ))}
      </ul>
      {state.exams.length < 8 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start -ml-2"
          onClick={() =>
            update((s) => ({
              ...s,
              exams: [...s.exams, { id: newId(), name: 'Exam', kind: 'cat', date: '', countFrom: '' }],
            }))
          }
        >
          <Plus size={15} /> Add an exam
        </Button>
      )}

      <Holidays state={state} update={update} />

      <div className="flex gap-2.5">
        <Button variant="brand" disabled={!ready} onClick={() => setOpen(false)}>
          Done
        </Button>
        {!ready && <p className="m-0 self-center text-[13px] text-ink2">Add at least one exam date.</p>}
      </div>
    </ToolCard>
  );
}

function ExamRow({
  exam,
  semesterStart,
  canRemove,
  onChange,
  onRemove,
}: {
  exam: Exam;
  semesterStart: string;
  canRemove: boolean;
  onChange: (patch: Partial<Exam>) => void;
  onRemove: () => void;
}) {
  const [ownWindow, setOwnWindow] = useState(!!exam.countFrom);
  return (
    <li className="flex flex-col gap-2.5 border-t border-dashed border-line pt-4">
      <div className="grid gap-3 grid-cols-[1fr_auto] sm:grid-cols-[1fr_1fr_auto] items-end">
        <Labelled label="Exam">
          <input
            className={field}
            value={exam.name}
            maxLength={40}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Labelled>
        <Labelled label="Starts on" className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto">
          <input
            type="date"
            className={field}
            value={exam.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </Labelled>
        {canRemove ? (
          <button
            type="button"
            aria-label={`Remove ${exam.name}`}
            onClick={onRemove}
            className="size-11 grid place-items-center rounded-full text-ink2 hover:bg-sunk col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto"
          >
            <Cross size={16} />
          </button>
        ) : (
          <span />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink2">
        <label className="inline-flex items-center gap-2">
          <span>Below 75%:</span>
          <select
            className="h-8 rounded-lg bg-surface border-[1.5px] border-line px-2 text-[13px] text-ink"
            value={exam.kind}
            onChange={(e) => onChange({ kind: e.target.value === 'final' ? 'final' : 'cat' })}
          >
            <option value="cat">needs teacher approval</option>
            <option value="final">not allowed to sit</option>
          </select>
        </label>
        <span aria-hidden>·</span>
        {ownWindow ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            Count classes from
            <input
              type="date"
              aria-label={`${exam.name}: count classes from`}
              className="h-8 rounded-lg bg-surface border-[1.5px] border-line px-2 text-[13px] text-ink"
              value={exam.countFrom}
              onChange={(e) => onChange({ countFrom: e.target.value })}
            />
            <button
              type="button"
              className="font-semibold text-teal-text hover:underline"
              onClick={() => {
                setOwnWindow(false);
                onChange({ countFrom: '' });
              }}
            >
              Use semester start
            </button>
          </span>
        ) : (
          <span>
            Counts from the semester start{semesterStart ? ` (${shortDay(semesterStart)})` : ''}.{' '}
            <button
              type="button"
              className="font-semibold text-teal-text hover:underline"
              onClick={() => setOwnWindow(true)}
            >
              Change
            </button>
          </span>
        )}
      </div>
      <p className="m-0 text-[12px] text-ink2">{RULE_TEXT[exam.kind]}</p>
    </li>
  );
}

function Holidays({ state, update }: { state: PlannerState; update: Update }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const add = () => {
    if (!isDay(from)) return;
    const end = isDay(to) && to >= from ? to : from;
    update((s) => ({
      ...s,
      holidays: [...s.holidays, { id: newId(), from, to: end, label: label.trim().slice(0, 60) }].sort(
        (a, b) => a.from.localeCompare(b.from),
      ),
    }));
    setFrom('');
    setTo('');
    setLabel('');
  };
  return (
    <div className="flex flex-col gap-3 border-t border-dashed border-line pt-4">
      <h3 className="m-0 text-[15px] font-bold">Holidays</h3>
      {state.holidays.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-2">
          {state.holidays.map((h) => (
            <li
              key={h.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-sunk pl-3 pr-1 h-8 text-[13px]"
            >
              <span className="font-semibold">
                {shortDay(h.from)}
                {h.to !== h.from && ` – ${shortDay(h.to)}`}
              </span>
              {h.label && <span className="text-ink2">{h.label}</span>}
              <button
                type="button"
                aria-label={`Remove holiday ${h.label || shortDay(h.from)}`}
                onClick={() => update((s) => ({ ...s, holidays: s.holidays.filter((x) => x.id !== h.id) }))}
                className="size-6 grid place-items-center rounded-full text-ink2 hover:bg-line"
              >
                <Cross size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-[1fr_1fr_1.4fr_auto] items-end">
        <Labelled label="From">
          <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Labelled>
        <Labelled label="To (optional)">
          <input
            type="date"
            className={field}
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
          />
        </Labelled>
        <Labelled label="Name (optional)" className="col-span-2 sm:col-span-1">
          <input
            className={field}
            value={label}
            maxLength={60}
            placeholder="e.g. Diwali break"
            onChange={(e) => setLabel(e.target.value)}
          />
        </Labelled>
        <Button variant="outline" className="col-span-2 sm:col-span-1" disabled={!isDay(from)} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}
