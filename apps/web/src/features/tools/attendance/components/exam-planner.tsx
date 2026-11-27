import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../../shared/ui/button';
import { Calendar, Plus } from '../../../../shared/ui/icons';
import { newId, useToolState } from '../../core/storage';
import { ToolCard } from '../../core/ui';
import {
  type Exam,
  type PlannerState,
  RULE_TEXT,
  campusToday,
  isDay,
  planFor,
  recordClass,
  shortDay,
  teachingDaysLeft,
  upcomingExam,
  weeklyFromSlots,
  windowOf,
  windowStart,
} from '../planner';
import { PlanSubjectRow, verdict } from './plan-subject-row';
import { SemesterSetup } from './semester-setup';

type Update = (fn: (s: PlannerState) => PlannerState) => void;

/** Registered Timetable maker courses, read field by field (old saved copies may differ). */
function useTimetableCourses() {
  const [raw] = useToolState<unknown>('timetable_courses', []);
  return useMemo(
    () =>
      (Array.isArray(raw) ? raw : []).flatMap((c) => {
        if (!c || typeof c !== 'object') return [];
        const o = c as Record<string, unknown>;
        const slots = Array.isArray(o.slots) ? o.slots.filter((s): s is string => typeof s === 'string') : [];
        if (typeof o.id !== 'string' || !slots.length || o.tentative === true) return [];
        const name =
          typeof o.name === 'string' && o.name.trim()
            ? o.name.trim()
            : typeof o.code === 'string'
              ? o.code
              : '';
        return name ? [{ id: o.id, name: name.slice(0, 80), slots }] : [];
      }),
    [raw],
  );
}

export function ExamPlanner({ state, update }: { state: PlannerState; update: Update }) {
  const today = campusToday();
  const courses = useTimetableCourses();
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const exam: Exam | undefined = state.exams.find((e) => e.id === picked) ?? upcomingExam(state.exams, today);
  const plans = useMemo(() => (exam ? planFor(state, exam, today) : []), [state, exam, today]);

  const importTimetable = () => {
    let added = 0;
    let updated = 0;
    const subjects = [...state.subjects];
    for (const c of courses) {
      const weekly = weeklyFromSlots(c.slots);
      const at = subjects.findIndex((x) => x.courseId === c.id);
      if (at >= 0) {
        subjects[at] = { ...subjects[at]!, name: c.name, weekly };
        updated++;
      } else if (subjects.length < 40) {
        subjects.push({ id: newId(), courseId: c.id, name: c.name, kind: 'theory', labWeight: 1, weekly });
        added++;
      }
    }
    update((s) => ({ ...s, subjects }));
    setNotice(
      added || updated
        ? `${added ? `Added ${added}` : ''}${added && updated ? ', ' : ''}${updated ? `updated ${updated}` : ''} from your timetable. Add labs with “Add a subject”.`
        : 'Nothing new in your timetable.',
    );
  };

  const addSubject = () =>
    update((s) => ({
      ...s,
      subjects: [
        ...s.subjects,
        {
          id: newId(),
          name: `Subject ${s.subjects.length + 1}`,
          kind: 'theory',
          labWeight: 1,
          weekly: [0, 0, 0, 0, 0, 0],
        },
      ],
    }));

  const known = plans.filter((p) => p.status !== 'empty' && p.status !== 'invalid');
  const safe = known.filter((p) => p.status === 'safe');
  const worst = [...known].sort((a, b) => {
    const rank = { risk: 0, recover: 1, safe: 2, empty: 3, invalid: 3 };
    return rank[a.status] - rank[b.status] || (a.canSkip ?? -1) - (b.canSkip ?? -1);
  })[0];
  const start = exam ? windowStart(state, exam) : '';
  const windowLabel = exam?.countFrom
    ? `since ${shortDay(exam.countFrom)}`
    : `since the semester start${state.semesterStart ? ` (${shortDay(state.semesterStart)})` : ''}`;

  return (
    <div className="flex flex-col gap-6">
      <SemesterSetup state={state} update={update} />

      {state.exams.length > 1 && (
        <div
          role="tablist"
          aria-label="Exam"
          className="flex gap-2 overflow-x-auto -mx-1 px-1 [scrollbar-width:none]"
        >
          {state.exams.map((e) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={exam?.id === e.id}
              onClick={() => setPicked(e.id)}
              className={`flex-none flex flex-col items-start rounded-2xl px-4 py-2 text-left transition-colors ${exam?.id === e.id ? 'bg-ink text-bg' : 'bg-sunk text-ink hover:bg-line'}`}
            >
              <span className="text-[14px] font-bold leading-tight">{e.name}</span>
              <span className={`text-[12px] ${exam?.id === e.id ? 'opacity-75' : 'text-ink2'}`}>
                {shortDay(e.date) || 'Add date'}
              </span>
            </button>
          ))}
        </div>
      )}

      {exam && (
        <div className="rounded-[18px] bg-brand text-white p-6 flex flex-col gap-3" aria-live="polite">
          <span className="font-mono text-[12px] text-on-brand2">
            {exam.name}
            {isDay(exam.date) &&
              (exam.date > today
                ? ` · ${shortDay(exam.date)} · ${teachingDaysLeft(state, exam, today)} teaching days left`
                : ` · started ${shortDay(exam.date)}`)}
          </span>
          {known.length ? (
            <>
              <span className="font-display font-extrabold text-[clamp(48px,9vw,72px)] leading-none tracking-[-0.05em] tabular-nums">
                {safe.length}/{known.length}
              </span>
              <span className="text-[15px] font-semibold">
                subject{known.length === 1 ? '' : 's'} on track for above 75%
              </span>
              {worst && worst.status !== 'safe' && (
                <p className="m-0 text-[14px] leading-snug text-on-brand2">
                  <span className="font-semibold text-white">{worst.subject.name}:</span>{' '}
                  {verdict(worst, exam)}
                </p>
              )}
            </>
          ) : (
            <span className="text-[17px] font-semibold leading-snug">
              {isDay(exam.date)
                ? 'Add your subjects below to see where you stand.'
                : `Add the ${exam.name} date above.`}
            </span>
          )}
          <p className="m-0 border-t border-dashed border-white/20 pt-3 text-[13px] text-on-brand2">
            {RULE_TEXT[exam.kind]} Rounded, so exactly 75% isn’t enough.
            {isDay(start) && start > today && ` Counting starts ${shortDay(start)}.`}
          </p>
        </div>
      )}

      <ToolCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="m-0 font-display font-extrabold text-[24px] tracking-[-0.03em] leading-none">
            Subjects{state.subjects.length ? ` (${state.subjects.length})` : ''}
          </h2>
          <div className="flex flex-wrap gap-2">
            {courses.length > 0 ? (
              <Button variant="brand" size="sm" onClick={importTimetable}>
                <Calendar size={15} /> From my timetable ({courses.length})
              </Button>
            ) : (
              <Link
                to="/tools/timetable"
                className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full text-[14px] font-semibold bg-sunk text-ink no-underline hover:bg-line"
              >
                <Calendar size={15} /> Make my timetable
              </Link>
            )}
            <Button variant="outline" size="sm" onClick={addSubject} disabled={state.subjects.length >= 40}>
              <Plus size={15} /> Add a subject
            </Button>
          </div>
        </div>
        {notice && (
          <p role="status" className="m-0 text-[13px] font-semibold text-teal-text">
            {notice}
          </p>
        )}
        {state.subjects.length === 0 ? (
          <p className="m-0 text-ink2 leading-relaxed">
            Bring in your subjects from the Timetable maker (it knows which days each class is on), or add
            them yourself. Then type classes held and attended from VTOP.
          </p>
        ) : (
          exam && (
            <ul className="m-0 p-0 list-none -mb-4">
              {plans.map((p) => (
                <PlanSubjectRow
                  key={p.subject.id}
                  plan={p}
                  exam={exam}
                  windowLabel={windowLabel}
                  onCounts={(c) =>
                    update((s) => ({
                      ...s,
                      counts: {
                        ...s.counts,
                        [p.subject.id]: { ...(s.counts[p.subject.id] ?? {}), [windowOf(exam)]: c },
                      },
                    }))
                  }
                  onRecord={(attended) => update((s) => recordClass(s, p.subject.id, attended, today))}
                  onChange={(next) =>
                    update((s) => ({ ...s, subjects: s.subjects.map((x) => (x.id === next.id ? next : x)) }))
                  }
                  onRemove={() =>
                    update((s) => {
                      const { [p.subject.id]: _gone, ...counts } = s.counts;
                      return { ...s, subjects: s.subjects.filter((x) => x.id !== p.subject.id), counts };
                    })
                  }
                />
              ))}
            </ul>
          )
        )}
      </ToolCard>
    </div>
  );
}
