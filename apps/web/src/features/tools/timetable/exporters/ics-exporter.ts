import { toIcs } from '../domain';
import { download } from './pdf';
import type { TimetableExporter } from './types';

/** A calendar file: every class repeats weekly in Google Calendar, Apple Calendar or Outlook. */
export const icsExporter: TimetableExporter = {
  id: 'ics',
  label: 'Add to calendar',
  export: (courses) =>
    download(new TextEncoder().encode(toIcs(courses, new Date())), 'timetable.ics', 'text/calendar'),
};
