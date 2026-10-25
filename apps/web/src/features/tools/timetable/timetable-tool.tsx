import { useState } from 'react';
import { Button } from '../../../shared/ui/button';
import { Sheet as Dialog } from '../../../shared/ui/feedback';
import { newId, useToolState } from '../core/storage';
import { ToolHeader } from '../core/ui';
import { type CourseDraft, CourseForm } from './components/course-form';
import { CourseList } from './components/course-list';
import { TimetableGrid } from './components/timetable-grid';
import { type Course, nextColor, stats } from './domain';
import { DEFAULT_EXPORTERS, type TimetableExporter } from './exporters';

const emptyDraft = (courses: Course[], slots: string[]): CourseDraft => ({
  name: '',
  code: '',
  teacher: '',
  slots,
  color: nextColor(courses),
  tentative: false,
});

/** Composes the grid, the course list, the add/edit dialog and the exporters it is given. */
export default function TimetableTool({
  exporters = DEFAULT_EXPORTERS,
}: { exporters?: TimetableExporter[] }) {
  const [courses, setCourses] = useToolState<Course[]>('timetable_courses', []);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState<CourseDraft | null>(null);
  const s = stats(courses);

  const save = (d: CourseDraft) => {
    setCourses((cs) =>
      d.id
        ? cs.map((c) => (c.id === d.id ? ({ ...d, id: d.id } as Course) : c))
        : [...cs, { ...d, id: newId() } as Course],
    );
    setPicked([]);
    setDraft(null);
  };
  const remove = (id: string) => {
    setCourses((cs) => cs.filter((c) => c.id !== id));
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <ToolHeader
        number="03"
        title="Timetable maker"
        lead="Tap your slots or type them (A1, B2…), name the course, and get a clash-free week you can save as an image or PDF."
        aside={
          <div className="flex flex-wrap gap-2 print:hidden">
            {exporters.map((x) => (
              <Button
                key={x.id}
                variant="outline"
                onClick={() => x.export(courses)}
                disabled={!courses.length}
              >
                {x.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-ink2 print:hidden">
        <span>
          <strong className="text-ink">{s.filled}</strong> of {s.total} slots filled
        </span>
        <span>
          <strong className="text-ink">{s.courses}</strong> courses
        </span>
        {s.tentative > 0 && (
          <span>
            <strong className="text-ink">{s.tentative}</strong> planned
          </span>
        )}
        <span className="flex-1" />
        <Button
          variant="brand"
          disabled={!picked.length}
          onClick={() => setDraft(emptyDraft(courses, picked))}
        >
          {picked.length
            ? `Add a course to ${picked.length} slot${picked.length === 1 ? '' : 's'}`
            : 'Tap slots to add a course'}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(emptyDraft(courses, []))}>
          Type slots instead
        </Button>
      </div>

      <TimetableGrid
        courses={courses}
        picked={picked}
        onPick={(slot) => setPicked((p) => (p.includes(slot) ? p.filter((x) => x !== slot) : [...p, slot]))}
        onOpen={setDraft}
      />

      <CourseList
        courses={courses}
        onEdit={setDraft}
        onRegister={(c) =>
          setCourses((cs) => cs.map((x) => (x.id === c.id ? { ...x, tentative: false } : x)))
        }
        onClear={() => setCourses([])}
      />

      <Dialog
        open={draft !== null}
        onOpenChange={(o) => !o && setDraft(null)}
        title={draft?.id ? 'Edit course' : 'Add a course'}
      >
        {draft && (
          <CourseForm
            key={draft.id ?? draft.slots.join()}
            draft={draft}
            courses={courses}
            onSave={save}
            onClose={() => setDraft(null)}
            onDelete={draft.id ? () => remove(draft.id!) : undefined}
          />
        )}
      </Dialog>
    </div>
  );
}
