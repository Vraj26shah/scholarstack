import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../../../lib/api';
import { Button } from '../../../../shared/ui/button';
import { ToolCard } from '../../core/ui';
import { type Course, clashes } from '../domain';

/** If Scholars Stack sells notes for this course, a link to them (looked up by name, quietly). */
function NotesLink({ course }: { course: Course }) {
  const name = course.name.trim();
  const q = useQuery({
    queryKey: ['timetable-notes', name.toLowerCase()],
    queryFn: () => api.search(name),
    enabled: name.length >= 4,
    staleTime: 600_000,
    retry: false,
  });
  const want = name.toLowerCase();
  // Only a real match: same title, or one contains the other ("DBMS" alone is too loose).
  const hit =
    q.data?.courses.find((c) => c.title.toLowerCase() === want) ??
    q.data?.courses.find((c) => c.title.toLowerCase().includes(want) || want.includes(c.title.toLowerCase()));
  if (!hit) return null;
  return (
    <Link to={`/c/${hit.slug}`} className="text-[13px] font-semibold text-teal-text">
      Notes for this →
    </Link>
  );
}

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
                {(c.teacher || c.room) && (
                  <p className="m-0 text-[13px] text-ink2">
                    {[c.room, c.teacher].filter(Boolean).join(' · ')}
                  </p>
                )}
                <NotesLink course={c} />
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
