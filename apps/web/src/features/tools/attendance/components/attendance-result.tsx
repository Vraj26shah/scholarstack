import { ResultPanel } from '../../core/ui';
import type { AttendanceResult } from '../domain';
import { MarksBar } from './marks-bar';
import { STANDING_TONE } from './tone';

/** The live result: percentage, standing, classes to miss or attend, and marks. */
export function AttendanceResultPanel({ result }: { result: AttendanceResult | null }) {
  return (
    <ResultPanel label="ATTENDANCE (ROUNDED)" value={result ? `${result.percent}%` : '––%'}>
      {result && (
        <span
          className={`self-start rounded-md px-2.5 py-1 text-[14px] font-semibold ${STANDING_TONE[result.standing]}`}
        >
          {result.label}
        </span>
      )}
      <div className="grid grid-cols-2 gap-3 border-t border-dashed border-white/20 pt-4">
        <div>
          <p className="m-0 text-[13px] text-on-brand2">You can miss</p>
          <p className="m-0 font-display font-extrabold text-[32px] leading-none">
            {result ? result.canMiss : '–'}
          </p>
        </div>
        <div>
          <p className="m-0 text-[13px] text-on-brand2">Attend in a row</p>
          <p className="m-0 font-display font-extrabold text-[32px] leading-none">
            {result ? result.mustAttend : '–'}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="m-0 text-[13px] text-on-brand2">
          Attendance marks: {result ? `${result.marks} of 5` : '–'}
        </p>
        <MarksBar marks={result?.marks ?? 0} />
      </div>
    </ResultPanel>
  );
}
