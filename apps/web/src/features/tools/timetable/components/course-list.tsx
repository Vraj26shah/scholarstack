import { useState } from 'react';
import { Button } from '../../../../shared/ui/button';
import { ToolCard } from '../../core/ui';
import { type Course, clashes } from '../domain';

/** Every course as a card: edit it, register a planned one, or clear them all (asks first). */
export function CourseList({
  courses,
  onEdit,
  onRegister,
  onClear,
}: {
  courses: Course[];
  onEdit: (c: Course) => void;
  onRegister: (c: Course) => void;
  onClear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <ToolCard title={courses.length ? 'Your courses' : 'No courses yet'} className="print:hidden">
      {courses.length === 0 ? (
        <p className="m-0 text-ink2">
          Tap the slots of a course in the grid, then “Add a course”. Everything stays on this device.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none grid gap-2.5 sm:grid-cols-2">
          {courses.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-xl border border-line p-3 min-w-0">
              <span
                className={`mt-1 size-4 flex-none rounded ${c.tentative ? 'border-2 border-dashed border-ink2' : ''}`}
                style={{ backgroundColor: c.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="m-0 font-semibold [overflow-wrap:anywhere]">
                  {c.code ? `${c.code} · ` : ''}
                  {c.name}
                  {c.tentative && <span className="ml-2 text-[12px] font-mono text-ink2">PLANNED</span>}
                </p>
                <p className="m-0 text-[13px] text-ink2 font-mono break-all">{c.slots.join(' ')}</p>
                {c.teacher && <p className="m-0 text-[13px] text-ink2">{c.teacher}</p>}
              </div>
              <div className="flex flex-col gap-1 flex-none">
                <Button variant="ghost" size="sm" onClick={() => onEdit(c)}>
                  Edit
                </Button>
                {c.tentative && clashes(courses, c.slots, false, c.id).length === 0 && (
                  <Button variant="ghost" size="sm" onClick={() => onRegister(c)}>
                    Register
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {courses.length > 0 &&
        (confirming ? (
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-sm font-semibold">Remove every course?</span>
            <Button
              variant="brand"
              size="sm"
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              Yes, clear it
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Keep them
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="self-start" onClick={() => setConfirming(true)}>
            Clear the timetable
          </Button>
        ))}
    </ToolCard>
  );
}
