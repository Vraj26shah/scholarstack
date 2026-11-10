import { describe, expect, it } from 'vitest';
import { studentFromEmail } from './format';

describe('studentFromEmail', () => {
  it('reads the batch and programme from a college address', () => {
    expect(studentFromEmail('vraj.23bce11796@vitbhopal.ac.in')).toEqual({
      batchYear: 2023,
      branchCode: 'BCE',
    });
    expect(studentFromEmail('Asha.Rao.24BAI10002@VITBhopal.ac.in')).toEqual({
      batchYear: 2024,
      branchCode: 'BAI',
    });
  });
  it('is null for anything else', () => {
    expect(studentFromEmail('vraj@gmail.com')).toBeNull();
    expect(studentFromEmail('librarian@vitbhopal.ac.in')).toBeNull();
    expect(studentFromEmail('vraj.23bce11796@gmail.com')).toBeNull();
  });
});
