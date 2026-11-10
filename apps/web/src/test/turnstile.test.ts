import { describe, expect, it } from 'vitest';
import { turnstileProblem } from '../features/auth/turnstile';

describe('turnstileProblem', () => {
  it('names a wrong site key for admins', () =>
    expect(turnstileProblem('110100', true)).toMatch(/wrong site key/));
  it('hides technical details on wrong site key for customers', () =>
    expect(turnstileProblem('110100', false)).toMatch(/contact support/));
  it('names a web address missing from the widget for admins', () =>
    expect(turnstileProblem('110200', true)).toMatch(/not allowed/));
  it('hides technical details on web address issue for customers', () =>
    expect(turnstileProblem('110200', false)).toMatch(/contact support/));
  it('asks to retry when the visitor could not be confirmed', () =>
    expect(turnstileProblem('300030')).toMatch(/[Rr]efresh the page/));
  it('points at blockers when the script never loads', () =>
    expect(turnstileProblem('script')).toMatch(/blockers/));
});
