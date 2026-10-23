import { describe, expect, it } from 'vitest';
import { isCollegeEmail } from './format';
import { scrambleMoves, tilePermutation, unscrambleMoves } from './tiles';

describe('tilePermutation', () => {
  it('is a permutation of all 64 tiles', () => {
    const p = tilePermutation('seed-abc');
    expect(p).toHaveLength(64);
    expect(new Set(p).size).toBe(64);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    expect(tilePermutation('a1b2c3d4')).toEqual(tilePermutation('a1b2c3d4'));
    expect(tilePermutation('a1b2c3d4')).not.toEqual(tilePermutation('a1b2c3d5'));
  });

  it('unscramble undoes scramble', () => {
    const grid = 8;
    const original = Array.from({ length: grid * grid }, (_, i) => i);
    const scrambled = new Array<number>(grid * grid);
    for (const m of scrambleMoves('round-trip', grid)) {
      scrambled[m.toRow * grid + m.toCol] = original[m.fromRow * grid + m.fromCol]!;
    }
    expect(scrambled).not.toEqual(original);
    const restored = new Array<number>(grid * grid);
    for (const m of unscrambleMoves('round-trip', grid)) {
      restored[m.toRow * grid + m.toCol] = scrambled[m.fromRow * grid + m.fromCol]!;
    }
    expect(restored).toEqual(original);
  });
});

describe('isCollegeEmail', () => {
  it.each([
    ['rahul.k2023@vitbhopal.ac.in', true],
    ['RAHUL@VITBHOPAL.AC.IN', true],
    ['rahul@gmail.com', false],
    ['rahul@vitbhopal.ac.in.evil.com', false],
    ['rahul@sub.vitbhopal.ac.in', false],
    ['@vitbhopal.ac.in', false],
  ])('%s → %s', (email, expected) => {
    expect(isCollegeEmail(email)).toBe(expected);
  });
});
