import { type ReactElement, useEffect, useState } from 'react';
import { Button } from '../../../shared/ui/button';
import { Sheet as Dialog } from '../../../shared/ui/feedback';
import { Calendar, DownloadIcon, PhotoIcon, Printer, ShareIcon } from '../../../shared/ui/icons';
import { ClassReminderSwitch, ClassReminders } from '../../reminders/class-reminders';
import { useSyncTimetableReminders } from '../../reminders/use-reminders';
import { newId, useToolState } from '../core/storage';
import { ToolHeader } from '../core/ui';
import { type CourseDraft, CourseForm } from './components/course-form';
import { CourseList } from './components/course-list';
import { DayView } from './components/day-view';
import { NowCard } from './components/now-card';
import { TimetableGrid } from './components/timetable-grid';
import { type Course, dayIndex, decodeShare, encodeShare, nextColor, stats } from './domain';
import { DEFAULT_EXPORTERS, type TimetableExporter } from './exporters';

const emptyDraft = (courses: Course[], slots: string[]): CourseDraft => ({
  name: '',
  code: '',
  teacher: '',
  room: '',
  slots,
  color: nextColor(courses),
  tentative: false,
});

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

/** "Tomorrow · 3 classes" opens ?day=tomorrow: the day view, on tomorrow. */
const tomorrowLink = () =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('day') === 'tomorrow';

/** A timetable someone shared (#t=… in the link), offered once, never applied without asking. */
function useSharedTimetable() {
  const [shared, setShared] = useState<Course[] | null>(null);
  useEffect(() => {
    // On load, and when a share link is opened while this page is already open.
    const read = () => {
      const m = /[#&]t=([\w-]+)/.exec(window.location.hash);
      if (m) setShared(decodeShare(m[1]!, newId));
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const dismiss = () => {
    setShared(null);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  };
  return { shared, dismiss };
}

/** Composes the now card, grid or day list, course list, add/edit dialog, exports and sharing. */
/** One look for every save and share action: same height, icon first, a clear press. */
const TOOL_BTN =
  'inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl border-[1.5px] text-[14.5px] font-semibold whitespace-nowrap cursor-pointer transition-[transform,filter,border-color] duration-100 active:scale-[0.97] disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100';
const EXPORT_ICON: Record<string, (p: { size?: number }) => ReactElement> = {
  png: PhotoIcon,
  ics: Calendar,
  print: Printer,
};
const EXPORT_LABEL: Record<string, string> = { png: 'Save image' };

export default function TimetableTool({
  exporters = DEFAULT_EXPORTERS,
}: { exporters?: TimetableExporter[] }) {
  const [courses, setCourses] = useToolState<Course[]>('timetable_courses', []);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState<CourseDraft | null>(null);
  const [view, setView] = useState<'week' | 'day'>(() => (isPhone() || tomorrowLink() ? 'day' : 'week'));
  useSyncTimetableReminders(courses);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const { shared, dismiss } = useSharedTimetable();
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
  const pick = (slot: string) =>
    setPicked((p) => (p.includes(slot) ? p.filter((x) => x !== slot) : [...p, slot]));

  const run = async (x: TimetableExporter) => {
    setBusy(x.id);
    setNotice(null);
    try {
      await x.export(courses);
    } catch {
      setNotice({
        tone: 'bad',
        text: `Couldn't make the ${x.label.toLowerCase()} in this browser. Try another one.`,
      });
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    const url = `${window.location.origin}/tools/timetable#t=${encodeShare(courses)}`;
    try {
      if (navigator.share) await navigator.share({ title: 'My timetable', url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice({
          tone: 'good',
          text: 'Link copied. Anyone who opens it can add your timetable to theirs.',
        });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        setNotice({
          tone: 'bad',
          text: "Couldn't copy the link. Long-press to copy it from the address bar.",
        });
    }
  };

  const primary = exporters.find((x) => x.primary);
  const others = exporters.filter((x) => !x.primary);

  return (
    <div className="flex flex-col gap-5">
      <ToolHeader
        title="Timetable maker"
        lead="Tap your slots or type them (A1, B2…), name the course, and get a clash-free week. Download it as a PDF, put it in your calendar, or share it with friends."
        aside={
          <div className="flex flex-col gap-2.5 print:hidden w-full sm:w-auto">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-2">
              {primary && (
                <button
                  type="button"
                  onClick={() => run(primary)}
                  disabled={!courses.length || !!busy}
                  className={`${TOOL_BTN} col-span-2 sm:col-span-1 bg-brand text-white border-brand hover:brightness-110`}
                >
                  <DownloadIcon size={18} />
                  {busy === primary.id ? 'Making it…' : primary.label}
                </button>
              )}
              {others.map((x) => {
                const Icon = EXPORT_ICON[x.id] ?? DownloadIcon;
                return (
                  <button
                    key={x.id}
                    type="button"
                    onClick={() => run(x)}
                    disabled={!courses.length || !!busy}
                    className={`${TOOL_BTN} bg-surface text-ink border-line hover:border-ink2`}
                  >
                    <Icon size={17} />
                    {busy === x.id ? 'Making it…' : (EXPORT_LABEL[x.id] ?? x.label)}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={share}
                disabled={!courses.length}
                className={`${TOOL_BTN} bg-surface text-ink border-line hover:border-ink2`}
              >
                <ShareIcon size={17} />
                Share link
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {courses.some((c) => !c.tentative) && <ClassReminderSwitch />}
              {!courses.length && (
                <span className="text-[13px] text-ink2">
                  Add a course first, then download, print or share your timetable.
                </span>
              )}
            </div>
          </div>
        }
      />

      {shared && (
        <section
          aria-label="A shared timetable"
          className="print:hidden flex flex-wrap items-center gap-3 rounded-[18px] border-2 border-teal bg-mist/30 p-4"
        >
          <p className="m-0 flex-1 min-w-[220px] text-[15px]">
            Someone shared a timetable with <strong>{shared.length} courses</strong>.
            {courses.length ? ' Add it as planned courses next to yours, or replace yours with it.' : ''}
          </p>
          {courses.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setCourses((cs) => [...cs, ...shared.map((c) => ({ ...c, tentative: true }))]);
                dismiss();
              }}
            >
              Add as planned
            </Button>
          )}
          <Button
            variant="brand"
            onClick={() => {
              setCourses(shared);
              dismiss();
            }}
          >
            {courses.length ? 'Replace mine' : 'Use this timetable'}
          </Button>
          <Button variant="ghost" onClick={dismiss}>
            No thanks
          </Button>
        </section>
      )}

      {notice && (
        <p
          role="status"
          className={`print:hidden m-0 rounded-xl px-4 py-3 text-[14px] ${notice.tone === 'good' ? 'bg-mist/50 text-ink' : 'bg-blush text-blush-text'}`}
        >
          {notice.text}
        </p>
      )}

      <NowCard courses={courses} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[14px] text-ink2 print:hidden">
        <div role="tablist" aria-label="View" className="inline-flex rounded-full border border-line p-1">
          {(['week', 'day'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`h-8 rounded-full px-4 text-[13px] font-semibold ${view === v ? 'bg-ink text-bg' : 'text-ink2'}`}
            >
              {v === 'week' ? 'Week' : 'Day'}
            </button>
          ))}
        </div>
        <span>
          <strong className="text-ink">{s.filled}</strong> of {s.total} slots ·{' '}
          <strong className="text-ink">{s.courses}</strong> courses
          {s.tentative > 0 && (
            <>
              {' '}
              · <strong className="text-ink">{s.tentative}</strong> planned
            </>
          )}
        </span>
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

      {picked.length > 0 && !draft && (
        <div
          role="region"
          aria-label="Picked slots"
          className="print:hidden fixed inset-x-3 sm:inset-x-auto sm:right-6 bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-6 z-30 flex items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-[0_18px_40px_-16px_rgba(0,0,0,0.7)]"
        >
          <span className="flex-1 sm:flex-none text-[14.5px] font-semibold">
            {picked.length} slot{picked.length === 1 ? '' : 's'} picked
            <span className="block text-[12px] font-normal opacity-75">{picked.join(', ')}</span>
          </span>
          <button
            type="button"
            onClick={() => setDraft(emptyDraft(courses, picked))}
            className="h-10 rounded-full bg-bg px-4 text-[14px] font-bold text-ink border-0 cursor-pointer"
          >
            Add course
          </button>
          <button
            type="button"
            onClick={() => setPicked([])}
            className="h-10 rounded-full px-3 text-[14px] font-semibold text-bg/80 bg-transparent border-0 underline underline-offset-2 cursor-pointer"
          >
            Clear
          </button>
        </div>
      )}

      {view === 'week' ? (
        <TimetableGrid courses={courses} picked={picked} onPick={pick} onOpen={setDraft} />
      ) : (
        <DayView
          courses={courses}
          picked={picked}
          onPick={pick}
          onOpen={setDraft}
          initialDay={tomorrowLink() ? (dayIndex(new Date()) + 1) % 7 : undefined}
        />
      )}

      <CourseList
        courses={courses}
        onEdit={setDraft}
        onRegister={(c) =>
          setCourses((cs) => cs.map((x) => (x.id === c.id ? { ...x, tentative: false } : x)))
        }
        onClear={() => setCourses([])}
      />

      {courses.some((c) => !c.tentative) && <ClassReminders courses={courses} />}

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
