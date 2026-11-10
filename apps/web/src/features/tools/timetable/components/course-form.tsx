import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { Button } from '../../../../shared/ui/button';
import { Labelled, field } from '../../core/ui';
import { COLORS, type Course, clashes, expandSlots } from '../domain';
import { SearchField, exactMatch, useCourseList } from './course-picker';

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
  // Course names from the Scholars Stack catalogue join the term's course list as suggestions.
  const catalogue = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue, staleTime: 300_000 });
  const list = useCourseList(catalogue.data?.stats?.subjects ?? []);
  // A saved course that isn't on the list opens as "Other", so nothing gets rewritten.
  const listed = (name: string, code: string) =>
    code
      ? exactMatch(list, 'code', code)?.name === name
      : !!name && exactMatch(list, 'name', name)?.code === '';
  const [other, setOther] = useState(() =>
    Boolean((draft.name || draft.code) && !listed(draft.name, draft.code)),
  );
  const [slotText, setSlotText] = useState(draft.slots.join(' + '));
  const parsed = expandSlots(slotText);
  const clash = clashes(courses, parsed.slots, d.tentative, d.id);
  // On the list, name and code always belong to the same course; under "Other" either or both.
  const named = other ? Boolean(d.name.trim() || d.code.trim()) : listed(d.name, d.code);
  const ready = named && parsed.slots.length > 0 && parsed.unknown.length === 0 && clash.length === 0;
  const pick = (c: { name: string; code: string }) => setD({ ...d, name: c.name, code: c.code });
  return (
    <div className="flex flex-col gap-4">
      {other && (
        <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-mist/40 px-3.5 py-2.5 text-[14px]">
          <span>
            <span className="font-semibold">Other course.</span> Add its name, its code, or both.
          </span>
          <button
            type="button"
            className="font-semibold text-teal-text underline underline-offset-4"
            onClick={() => {
              setOther(false);
              setD({ ...d, name: '', code: '' });
            }}
          >
            Pick from the list instead
          </button>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SearchField
          label="Course name"
          by="name"
          value={d.name}
          list={list}
          other={other}
          placeholder={other ? 'e.g. Robotics Lab' : 'Search, e.g. Operating Systems'}
          onType={(name) => {
            if (other) return setD({ ...d, name });
            const hit = exactMatch(list, 'name', name);
            setD({ ...d, name, code: hit ? hit.code : '' });
          }}
          onPick={pick}
          onOther={() => setOther(true)}
        />
        <SearchField
          label="Course code"
          by="code"
          value={d.code}
          list={list.filter((c) => c.code)}
          other={other}
          placeholder={other ? 'e.g. ROB1001' : 'Search, e.g. CSE3003'}
          onType={(code) => {
            if (other) return setD({ ...d, code });
            const hit = exactMatch(list, 'code', code);
            setD({ ...d, code, name: hit ? hit.name : '' });
          }}
          onPick={pick}
          onOther={() => setOther(true)}
        />
        {!other && (d.name || d.code) && !named && (
          <p className="m-0 sm:col-span-2 text-[13px] text-ink2">
            Pick your course from the list, or choose <span className="font-semibold">Other</span> at the
            bottom of it if yours isn't there.
          </p>
        )}
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
          <label
            className={`relative size-9 rounded-lg border-2 cursor-pointer overflow-hidden ${
              COLORS.includes(d.color) ? 'border-dashed border-line' : 'border-ink'
            }`}
            title="Pick your own colour"
            style={
              COLORS.includes(d.color)
                ? { background: 'conic-gradient(#F5C96B, #FBC3C9, #D7C8F2, #A1D6E2, #B9E4C9, #F5C96B)' }
                : { backgroundColor: d.color }
            }
          >
            <span className="sr-only">Your own colour</span>
            <input
              type="color"
              aria-label="Your own colour"
              value={d.color}
              onChange={(e) => setD({ ...d, color: e.target.value.toUpperCase() })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
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
          onClick={() =>
            onSave({ ...d, slots: parsed.slots, code: d.code.trim(), name: d.name.trim() || d.code.trim() })
          }
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
