import type { Course } from '../domain';

/**
 * One way to take a timetable out of the site. The screen shows a button per exporter and knows
 * nothing else about them, so a new format (a calendar file, a share link) is one new file here.
 */
export interface TimetableExporter {
  id: string;
  label: string;
  export(courses: Course[]): void;
}
