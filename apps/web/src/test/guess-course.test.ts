import type { AdminCourseDto } from '@ss/contracts';
import { describe, expect, it } from 'vitest';
import { guessCourse } from '../features/admin/upload-pipeline';

const course = (id: string, title: string, courseCode: string | null = null, status = 'live') =>
  ({ id, title, courseCode, status }) as AdminCourseDto;
const all = [
  course('calc', 'Calculus and Differential Equations'),
  course('dbms', 'Database Management Systems', 'CSE3001'),
  course('os', 'Operating Systems'),
  course('cn', 'Computer Networks'),
];

describe('guessing the course a student meant', () => {
  it('understands short forms and ignores filler words', () => {
    expect(guessCourse('DBMS', 'DBMS unit 6: recovery and concurrency, handwritten', all)).toBe('dbms');
    expect(guessCourse('OS', 'Unit 3 notes', all)).toBe('os');
    expect(guessCourse('cse3001', '', all)).toBe('dbms');
  });
  it('picks nothing when unsure', () => {
    expect(guessCourse('', 'Unit 2 handwritten notes and examples', all)).toBe('');
    expect(guessCourse('physics', 'Waves', all)).toBe('');
  });
});
