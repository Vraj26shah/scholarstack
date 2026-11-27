import { ToolCard } from '../../core/ui';

/** The counting rules, in plain words. */
export function RulesCard() {
  return (
    <ToolCard title="How it’s counted">
      <ul className="m-0 pl-5 text-[14px] leading-relaxed text-ink2 flex flex-col gap-1">
        <li>CAT 1, CAT 2 and Term End each need above 75%.</li>
        <li>
          Below 75% at a CAT, you need your teacher’s approval to sit it. Below 75% at Term End, you can’t sit
          it.
        </li>
        <li>The percentage is rounded to a whole number, so exactly 75% isn’t enough.</li>
        <li>Marks: above 75% → 1, 80% → 2, 85% → 3, 90% → 4, 95% → 5.</li>
      </ul>
    </ToolCard>
  );
}
