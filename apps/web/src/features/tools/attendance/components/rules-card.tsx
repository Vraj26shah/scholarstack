import { ToolCard } from '../../core/ui';

/** The counting rules, in plain words. */
export function RulesCard() {
  return (
    <ToolCard title="How it’s counted">
      <ul className="m-0 pl-5 text-[14px] leading-relaxed text-ink2 flex flex-col gap-1">
        <li>The percentage is rounded to a whole number.</li>
        <li>You need above 75% to sit the exam; exactly 75% isn’t enough.</li>
        <li>Marks: above 75% → 1, 80% → 2, 85% → 3, 90% → 4, 95% → 5.</li>
        <li>An estimate: your faculty’s count is the one that counts.</li>
      </ul>
    </ToolCard>
  );
}
