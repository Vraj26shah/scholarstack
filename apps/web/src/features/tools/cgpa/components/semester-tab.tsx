import { Button } from '../../../../shared/ui/button';
import { newId, useToolState } from '../../core/storage';
import { ResultPanel, ToolCard } from '../../core/ui';
import { GRADES, GRADE_POINTS, type SubjectRow, fmt, semesterGpa } from '../domain';
import { SubjectRowEditor } from './subject-row';

const blank = (): SubjectRow => ({ id: newId(), name: '', credits: '', grade: '' });
const fresh = () => [blank(), blank(), blank(), blank()];

/** This semester's GPA from its subjects. */
export function SemesterTab() {
  const [rows, setRows] = useToolState<SubjectRow[]>('cgpa_subjects', fresh());
  const result = semesterGpa(rows);
  const update = (id: string, patch: Partial<SubjectRow>) =>
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      <ToolCard title="Your subjects">
        <ol className="m-0 p-0 list-none flex flex-col gap-3">
          {rows.map((row, i) => (
            <SubjectRowEditor
              key={row.id}
              row={row}
              index={i}
              onChange={(patch) => update(row.id, patch)}
              onRemove={() => setRows((xs) => xs.filter((x) => x.id !== row.id))}
            />
          ))}
        </ol>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="outline" onClick={() => setRows((xs) => [...xs, blank()])}>
            Add a subject
          </Button>
          <Button variant="ghost" onClick={() => setRows(fresh())}>
            Start over
          </Button>
        </div>
        <p className="m-0 text-[13px] text-ink2">
          Grade points: {GRADES.map((g) => `${g} ${GRADE_POINTS[g]}`).join(' · ')}.
        </p>
      </ToolCard>
      <div className="lg:sticky lg:top-6">
        <ResultPanel label="THIS SEMESTER’S GPA" value={result ? fmt(result.gpa) : '–.––'}>
          <span className="text-[15px] text-on-brand2">
            {result
              ? `${result.counted} subjects · ${result.credits} credits`
              : 'Add credits and a grade for each subject.'}
          </span>
        </ResultPanel>
      </div>
    </div>
  );
}
