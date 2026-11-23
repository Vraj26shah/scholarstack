import { type MealKey, type ReminderClass, ReminderPrefs } from '@ss/contracts';
import { useSyncExternalStore } from 'react';
import { browserStore } from '../tools/core/storage';
import { type Course, GRID, dayClasses } from '../tools/timetable/domain';

/**
 * What this device asked for, kept in the browser. The server gets a copy (ReminderPrefs) with
 * only the classes the student ticked. The full timetable never leaves the device.
 */
export interface LocalReminders {
  /** This device's push address once reminders are on; null when off. */
  endpoint: string | null;
  mess: { slug: string | null; meals: MealKey[]; lead: number; favourites: string[] };
  classes: {
    nightly: boolean;
    nightlyAt: string;
    before: boolean;
    lead: number;
    days: number[];
    /** Timetable course ids to remind about ('all': every course, including ones added later). */
    courseIds: string[] | 'all';
  };
  /** "Not now" on the ask card: hidden until then (ms). */
  snoozedUntil: number | null;
}

export const DEFAULT_REMINDERS: LocalReminders = {
  endpoint: null,
  mess: { slug: null, meals: ['lunch', 'dinner'], lead: 30, favourites: [] },
  classes: {
    nightly: false,
    nightlyAt: '21:00',
    before: false,
    lead: 10,
    days: [0, 1, 2, 3, 4, 5],
    courseIds: 'all',
  },
  snoozedUntil: null,
};

const KEY = 'ss_reminders';
const listeners = new Set<() => void>();

function read(): LocalReminders {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_REMINDERS;
    const v = JSON.parse(raw) as Partial<LocalReminders>;
    return {
      ...DEFAULT_REMINDERS,
      ...v,
      mess: { ...DEFAULT_REMINDERS.mess, ...v.mess },
      classes: { ...DEFAULT_REMINDERS.classes, ...v.classes },
    };
  } catch {
    return DEFAULT_REMINDERS;
  }
}

let snapshot = typeof window === 'undefined' ? DEFAULT_REMINDERS : read();

export function setLocalReminders(next: LocalReminders | ((prev: LocalReminders) => LocalReminders)) {
  snapshot = typeof next === 'function' ? next(snapshot) : next;
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // private mode: remembered until the tab closes
  }
  for (const l of listeners) l();
}

export function useLocalReminders(): LocalReminders {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          snapshot = read();
          cb();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener('storage', onStorage);
      };
    },
    () => snapshot,
    () => DEFAULT_REMINDERS,
  );
}

/** The timetable saved on this device (the Timetable maker's own storage). */
export const savedTimetable = (): Course[] => browserStore.load<Course[]>('timetable_courses', []);

/** Each course's start times across the week, for the courses the student ticked. */
export function classesFor(courses: Course[], ids: string[] | 'all'): ReminderClass[] {
  const byId = new Map<string, ReminderClass>();
  for (let day = 0; day < GRID.length; day++)
    for (const slot of dayClasses(courses, day)) {
      const c = slot.course;
      if (ids !== 'all' && !ids.includes(c.id)) continue;
      if (!byId.has(c.id))
        byId.set(c.id, {
          code: c.code.slice(0, 20),
          name: (c.name || c.code || 'Class').slice(0, 80),
          room: (c.room ?? '').slice(0, 40),
          times: [],
        });
      byId.get(c.id)!.times.push({ day, start: slot.start });
    }
  return [...byId.values()].slice(0, 20);
}

/** The copy the server keeps for this device. */
export function serverPrefs(local: LocalReminders, courses: Course[] = savedTimetable()): ReminderPrefs {
  return ReminderPrefs.parse({
    mess: local.mess,
    classes: {
      nightly: local.classes.nightly,
      nightlyAt: local.classes.nightlyAt,
      before: local.classes.before,
      lead: local.classes.lead,
      days: local.classes.days,
      courses:
        local.classes.nightly || local.classes.before ? classesFor(courses, local.classes.courseIds) : [],
    },
    mutedOn: null,
  });
}
