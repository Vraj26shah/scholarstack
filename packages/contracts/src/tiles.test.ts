import { describe, expect, it } from 'vitest';
import { isCollegeEmail, isListedEmail } from './format';
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
    ['asha.23bce10001@vitbhopal.ac.in', true],
    ['  Asha.23BCE10001@VITBHOPAL.AC.IN  ', true],
    // One inbox must not become many accounts.
    ['rahul+2@vitbhopal.ac.in', false],
    ['rahul%x@vitbhopal.ac.in', false],
    ['rahul..k@vitbhopal.ac.in', false],
    ['.rahul@vitbhopal.ac.in', false],
    ['rahul.@vitbhopal.ac.in', false],
    // Look-alike letters and hidden characters.
    ['rаhul@vitbhopal.ac.in', false],
    ['rahul\u200b@vitbhopal.ac.in', false],
    ['rahul@vitbhopal.ac.in\n', true],
    ['rahul@vitbhopal.ac.in x', false],
    ['rahul@vitbhopal.ac.in@gmail.com', false],
    ['vitbsmashers@gmail.com', false],
  ])('%s → %s', (email, expected) => {
    expect(isCollegeEmail(email)).toBe(expected);
  });
});

describe('isListedEmail (admin list)', () => {
  const admins = ['vitbsmashers@gmail.com'];
  it.each([
    ['vitbsmashers@gmail.com', true],
    ['  VitbSmashers@Gmail.COM ', true],
    ['vit.bsmashers@gmail.com', false],
    ['vitbsmashers+admin@gmail.com', false],
    ['vitbsmashers@gmail.com.evil.in', false],
    ['vitbsmashers@gmai1.com', false],
    ['vitbsmashers@gmаil.com', false],
    ['vitbsmashers@gmail.com\u0000', false],
    ['xvitbsmashers@gmail.com', false],
    ['', false],
  ])('%s → %s', (email, expected) => {
    expect(isListedEmail(email, admins)).toBe(expected);
  });
});
