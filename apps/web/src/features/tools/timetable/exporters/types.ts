import type { Course } from '../domain';

/**
 * One way to take a timetable out of the site. The screen shows a button per exporter and knows
 * nothing else about them, so a new format is one new file here.
 */
export interface TimetableExporter {
  id: string;
  label: string;
  /** Shown as the main button. */
  primary?: boolean;
  export(courses: Course[]): void | Promise<void>;
}
