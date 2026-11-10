import { describe, expect, it } from 'vitest';
import { contributorDisplayName } from './contributor-name';

describe('contributorDisplayName', () => {
  it('prefers a saved name', () => {
    expect(contributorDisplayName('  Vraj Shah  ', 'vraj.23bce@vitbhopal.ac.in')).toBe('Vraj Shah');
  });

  it('uses a readable email username without exposing the domain', () => {
    expect(contributorDisplayName(null, 'vraj.23bce11796@vitbhopal.ac.in')).toBe('Vraj 23bce11796');
  });

  it('uses a safe fallback for an unusable email', () => {
    expect(contributorDisplayName('', '@vitbhopal.ac.in')).toBe('Student contributor');
  });
});
