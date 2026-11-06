import { describe, expect, it } from 'vitest';
import { cohortYearFromSemester, studyYearFromSemester } from './study-year.js';

describe('studyYearFromSemester', () => {
  it.each([
    [1, 1],
    [2, 1],
    [3, 2],
    [4, 2],
    [5, 3],
    [8, 4],
    [10, 5],
  ])('maps semester %i into academic year %i', (semester, year) => {
    expect(studyYearFromSemester(semester)).toBe(year);
  });

  it.each([0, -1, null, undefined, 1.5])('returns null for invalid semester %s', (semester) => {
    expect(studyYearFromSemester(semester)).toBeNull();
  });
});

describe('cohortYearFromSemester', () => {
  it.each([
    [1, 2026],
    [2, 2026],
    [3, 2025],
    [4, 2025],
    [5, 2024],
    [6, 2024],
    [7, 2023],
    [8, 2023],
    [9, 2022],
    [10, 2022],
  ])('maps semester %i to intake cohort %i', (semester, year) => {
    expect(cohortYearFromSemester(semester)).toBe(year);
  });

  it.each([0, -1, null, undefined, 11, 1.5])('returns null for invalid semester %s', (semester) => {
    expect(cohortYearFromSemester(semester)).toBeNull();
  });
});
