import { useToolState } from '../../core/storage';
import { Labelled, ResultPanel, ToolCard, field, toNumber } from '../../core/ui';
import { fmt, neededNext } from '../domain';

type Plan = { current: number | ''; done: number | ''; next: number | ''; target: number | '' };

/** The GPA needed next semester to reach a target CGPA. */
export function NeedTab() {
  const [plan, setPlan] = useToolState<Plan>('cgpa_need', { current: '', done: '', next: '', target: '' });
  const filled = Object.values(plan).every((v) => v !== '');
  const r = filled
    ? neededNext(Number(plan.current), Number(plan.done), Number(plan.next), Number(plan.target))
    : null;
  const input = (key: keyof Plan, label: string, step = '1', max?: number) => (
    <Labelled label={label}>
      <input
        className={field}
        type="number"
        inputMode="decimal"
        step={step}
        min={0}
        max={max}
        value={plan[key]}
        onChange={(e) => setPlan({ ...plan, [key]: toNumber(e.target.value) })}
      />
    </Labelled>
  );
  const value = r ? (r.alreadyThere ? 'Done' : r.reachable ? fmt(r.needed) : '> 10') : '–.––';
  const note = !r
    ? filled
      ? 'Use GPAs from 0 to 10 and enter positive credits for next semester.'
      : 'Fill in all four.'
    : r.alreadyThere
      ? 'You’ll stay at or above that target whatever happens next semester.'
      : r.reachable
        ? 'Average this across next semester’s subjects to hit your target.'
        : 'Not reachable in one semester. Try a closer target, or plan over two semesters.';
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px] items-start">
      <ToolCard title="Where you are, where you want to be">
        <div className="grid gap-3 sm:grid-cols-2">
          {input('current', 'Your CGPA now', '0.01', 10)}
          {input('done', 'Credits completed')}
          {input('next', 'Credits next semester')}
          {input('target', 'CGPA you want', '0.01', 10)}
        </div>
      </ToolCard>
      <div className="lg:sticky lg:top-6">
        <ResultPanel label="GPA needed next semester" value={value}>
          <span className="text-[15px] text-on-brand2">{note}</span>
        </ResultPanel>
      </div>
    </div>
  );
}
