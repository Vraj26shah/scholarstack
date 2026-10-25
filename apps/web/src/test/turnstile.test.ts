import { describe, expect, it } from 'vitest';
import { turnstileProblem } from '../features/auth/turnstile';

describe('turnstileProblem', () => {
  it('names a wrong site key', () => expect(turnstileProblem('110100')).toMatch(/wrong site key/));
  it('names a web address missing from the widget', () =>
    expect(turnstileProblem('110200')).toMatch(/not allowed on this web address/));
  it('asks to retry when the visitor could not be confirmed', () =>
    expect(turnstileProblem('300030')).toMatch(/Refresh the page/));
  it('points at blockers when the script never loads', () =>
    expect(turnstileProblem('script')).toMatch(/blockers/));
});
