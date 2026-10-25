import { Button } from '../../../../shared/ui/button';
import { Cross } from '../../../../shared/ui/icons';
import { ToolCard } from '../../core/ui';
import { evaluate } from '../domain';
import { STANDING_TONE } from './tone';

export interface SavedSubject {
  id: string;
  name: string;
  attended: number;
  total: number;
}

function SubjectLine({
  s,
  onChange,
  onRemove,
}: { s: SavedSubject; onChange: (s: SavedSubject) => void; onRemove: () => void }) {
  const r = evaluate(s.attended, s.total);
  if ('error' in r) return null;
  return (
    <li className="flex flex-col gap-2.5 border-b border-dashed border-line pb-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <p className="m-0 font-semibold [overflow-wrap:anywhere]">{s.name}</p>
          <p className="m-0 text-[13px] text-ink2">
            {s.attended} of {s.total} classes ·{' '}
            {r.standing === 'safe' ? `can miss ${r.canMiss}` : `attend the next ${r.mustAttend}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-none">
          <span
            className={`rounded-md px-2 py-0.5 font-mono text-[14px] font-semibold ${STANDING_TONE[r.standing]}`}
          >
            {r.percent}%
          </span>
          <button
            type="button"
            aria-label={`Remove ${s.name}`}
            onClick={onRemove}
            className="size-8 grid place-items-center rounded-full text-ink2 hover:bg-sunk"
          >
            <Cross size={15} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...s, attended: s.attended + 1, total: s.total + 1 })}
        >
          + Attended a class
        </Button>
        <Button variant="outline" size="sm" onClick={() => onChange({ ...s, total: s.total + 1 })}>
          + Missed a class
        </Button>
      </div>
    </li>
  );
}

/** The saved subjects, each updated with one tap after a class. */
export function SavedSubjects({
  subjects,
  onChange,
}: { subjects: SavedSubject[]; onChange: (next: SavedSubject[]) => void }) {
  return (
    <ToolCard title={`Your subjects${subjects.length ? ` (${subjects.length})` : ''}`}>
      {subjects.length === 0 ? (
        <p className="m-0 text-ink2">Save a subject and update it after each class with one tap.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {subjects.map((s) => (
            <SubjectLine
              key={s.id}
              s={s}
              onChange={(next) => onChange(subjects.map((x) => (x.id === s.id ? next : x)))}
              onRemove={() => onChange(subjects.filter((x) => x.id !== s.id))}
            />
          ))}
        </ul>
      )}
    </ToolCard>
  );
}
