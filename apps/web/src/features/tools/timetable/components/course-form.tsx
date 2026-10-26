import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { Button } from '../../../../shared/ui/button';
import { Labelled, field } from '../../core/ui';
import { COLORS, type Course, clashes, expandSlots } from '../domain';

export type CourseDraft = Omit<Course, 'id'> & { id?: string };

/** Add or edit one course: details, slots (typed or picked), colour, planning flag; checks clashes. */
export function CourseForm({
  draft,
  courses,
  onSave,
  onDelete,
  onClose,
}: {
  draft: CourseDraft;
  courses: Course[];
  onSave: (d: CourseDraft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(draft);
  // Course names from the Scholars Stack catalogue, as suggestions (typing anything still works).
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 300_000 });
  const subjects = catalogue.data?.stats?.subjects ?? [];
  const [slotText, setSlotText] = useState(draft.slots.join(' + '));
  const parsed = expandSlots(slotText);
  const clash = clashes(courses, parsed.slots, d.tentative, d.id);
  const ready = parsed.slots.length > 0 && parsed.unknown.length === 0 && clash.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labelled label="Course name">
          <input
            className={field}
            value={d.name}
            list="timetable-subjects"
            onChange={(e) => setD({ ...d, name: e.target.value })}
            placeholder="e.g. Operating Systems"
          />
          <datalist id="timetable-subjects">
            {subjects.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Labelled>
        <Labelled label="Course code">
          <input
            className={field}
            value={d.code}
            onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })}
            placeholder="e.g. CSE3003"
          />
        </Labelled>
        <Labelled label="Faculty (optional)">
          <input
            className={field}
            value={d.teacher}
            onChange={(e) => setD({ ...d, teacher: e.target.value })}
          />
        </Labelled>
        <Labelled label="Room (optional)">
          <input
            className={field}
            value={d.room ?? ''}
            maxLength={30}
            onChange={(e) => setD({ ...d, room: e.target.value })}
            placeholder="e.g. AB1-204"
          />
        </Labelled>
        <Labelled label="Slots" className="sm:col-span-2">
          <input
            className={`${field} font-mono uppercase`}
            value={slotText}
            onChange={(e) => setSlotText(e.target.value)}
            placeholder="A1 + B2 or A11 A12 A13"
          />
          <span className="font-normal text-[13px]">
            {parsed.slots.length
              ? `${parsed.slots.length} slots: ${parsed.slots.join(', ')}`
              : 'Type a slot group like A1 (= A11, A12, A13) or single slots.'}
          </span>
        </Labelled>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-ink2">Colour</span>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={d.color === c}
              onClick={() => setD({ ...d, color: c })}
              className={`size-9 rounded-lg border-2 ${d.color === c ? 'border-ink' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2.5 text-[15px]">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-teal"
          checked={d.tentative}
          onChange={(e) => setD({ ...d, tentative: e.target.checked })}
        />
        <span>
          <span className="font-semibold">Just planning (tentative)</span>
          <br />
          <span className="text-ink2 text-[14px]">
            Shown dashed. Planned courses can overlap while you compare options.
          </span>
        </span>
      </label>
      {parsed.unknown.length > 0 && (
        <p className="m-0 text-sm font-semibold text-blush-text">
          Not a slot on this grid: {parsed.unknown.join(', ')}
        </p>
      )}
      {clash.length > 0 && (
        <p className="m-0 text-sm font-semibold text-blush-text">
          Clash: {clash.map((c) => `${c.slot} (${c.course.code || c.course.name})`).join(', ')}. Pick other
          slots, or mark this one as planning.
        </p>
      )}
      <div className="flex flex-wrap gap-2.5">
        <Button
          variant="brand"
          disabled={!ready}
          onClick={() => onSave({ ...d, slots: parsed.slots, name: d.name.trim() || d.code || 'Course' })}
        >
          {d.id ? 'Save changes' : 'Add to timetable'}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        {onDelete && (
          <Button variant="ghost" className="text-blush-text" onClick={onDelete}>
            Remove course
          </Button>
        )}
      </div>
    </div>
  );
}
