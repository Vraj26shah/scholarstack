import { useMemo } from 'react';
import { newId, useToolState } from '../core/storage';
import { Tabs, ToolHeader } from '../core/ui';
import { AttendanceResultPanel } from './components/attendance-result';
import { ExamPlanner } from './components/exam-planner';
import { RulesCard } from './components/rules-card';
import { SubjectForm } from './components/subject-form';
import { type PlannerState, readState } from './planner';
import { useSubjectDraft } from './use-subject-draft';

type Mode = 'plan' | 'quick';

/** Two ways in: the exam planner (CAT 1, CAT 2, Term End) and a one-subject quick check. */
export default function AttendanceTool() {
  const [modeRaw, setMode] = useToolState<unknown>('attendance_mode', 'plan');
  const mode: Mode = modeRaw === 'quick' ? 'quick' : 'plan';
  const [raw, setRaw] = useToolState<unknown>('attendance_planner', null);
  // The old saved list ("Your subjects") moves into the planner the first time it opens.
  const [legacy] = useToolState<unknown>('attendance_subjects', null);
  const state = useMemo(() => readState(raw, legacy), [raw, legacy]);
  const update = (fn: (s: PlannerState) => PlannerState) =>
    setRaw((prev: unknown) => fn(readState(prev, legacy)));

  const draft = useSubjectDraft();
  const saveToPlanner = () => {
    if (!draft.result) return;
    const id = newId();
    update((s) => ({
      ...s,
      subjects: [
        ...s.subjects,
        {
          id,
          name: draft.name.trim() || `Subject ${s.subjects.length + 1}`,
          kind: 'theory',
          labWeight: 1,
          weekly: [0, 0, 0, 0, 0, 0],
        },
      ],
      counts: { ...s.counts, [id]: { '': { attended: Number(draft.attended), held: Number(draft.total) } } },
    }));
    draft.clear();
    setMode('plan');
  };

  return (
    <div className="flex flex-col gap-6">
      <ToolHeader
        title="Attendance calculator"
        lead="Where you stand for CAT 1, CAT 2 and Term End: how many classes you can skip, how many you must attend, and your attendance marks."
      />
      <Tabs<Mode>
        value={mode}
        onChange={setMode}
        items={[
          ['plan', 'Exam planner'],
          ['quick', 'Quick check'],
        ]}
      />
      {mode === 'plan' ? (
        <ExamPlanner state={state} update={update} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_380px] items-start">
          <div className="min-w-0 flex flex-col gap-5">
            <SubjectForm draft={draft} onSave={saveToPlanner} saveLabel="Add to my exam planner" />
            <div className="hidden lg:block">
              <RulesCard />
            </div>
          </div>
          <div className="flex flex-col gap-5 lg:sticky lg:top-6">
            <AttendanceResultPanel result={draft.result} />
            <div className="lg:hidden">
              <RulesCard />
            </div>
          </div>
        </div>
      )}
      <Credit />
    </div>
  );
}

function Credit() {
  return (
    <p className="m-0 border-t border-line pt-5 text-[13px] leading-relaxed text-ink2 max-w-[720px]">
      An estimate: the count on VTOP and your faculty’s decision are final. The idea of planning from your
      timetable comes from{' '}
      <a
        href="https://github.com/prteek99/attendance_calculator"
        target="_blank"
        rel="noreferrer noopener"
        className="font-semibold text-teal-text hover:underline"
      >
        Prateek Kumar’s attendance calculator
      </a>
      , which many VIT Bhopal students use. Thank you, Prateek.
    </p>
  );
}
