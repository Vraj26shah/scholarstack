import { describe, expect, it } from 'vitest';
import { readCart } from '../features/tools/mess/components/order-panel';
import { mobileHint, tidyMobile } from '../lib/mobile';
import { localPath, signInPath } from '../lib/return-to';

describe('the mobile number box', () => {
  it('takes any way of writing a number and shows it as 98765 43210', () => {
    expect(tidyMobile('9876543210')).toBe('98765 43210');
    expect(tidyMobile('+91 98765-43210')).toBe('98765 43210');
    expect(tidyMobile('0091 98765 43210')).toBe('98765 43210');
    expect(tidyMobile('098765 43210')).toBe('98765 43210');
    expect(tidyMobile('98765')).toBe('98765');
    expect(tidyMobile('987654')).toBe('98765 4');
    expect(tidyMobile('abc')).toBe('');
  });
  it('says what is missing while typing', () => {
    expect(mobileHint('')).toBeNull();
    expect(mobileHint('98765')).toEqual({ ok: false, text: '5 more digits' });
    expect(mobileHint('98765 4321')).toEqual({ ok: false, text: '1 more digit' });
    expect(mobileHint('98765 43210')).toEqual({ ok: true, text: 'Looks right' });
    expect(mobileHint('12345 67890')?.ok).toBe(false);
  });
});

describe('the saved cart', () => {
  it('keeps a recent cart and drops odd or old ones', () => {
    const now = Date.now();
    expect(readCart({ items: { a: 2, b: 1 }, at: now })).toEqual({ a: 2, b: 1 });
    expect(readCart({ items: { a: 2, b: -1, c: 'x', d: 1.5, e: 99 }, at: now })).toEqual({ a: 2 });
    expect(readCart({ items: { a: 2 }, at: now - 2 * 86_400_000 })).toEqual({});
    for (const junk of [null, 'x', 3, [], { items: { a: 1 } }, { at: now }])
      expect(readCart(junk)).toEqual({});
  });
});

describe('coming back after signing in', () => {
  it('only ever returns to a page on this site', () => {
    expect(localPath('/tools/mess-menu?mess=a#order-slip')).toBe('/tools/mess-menu?mess=a#order-slip');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', '', null])
      expect(localPath(bad)).toBeNull();
  });
  it('builds the sign-in link with the page to come back to', () => {
    expect(signInPath('/shelf?tab=x')).toBe('/sign-in?next=%2Fshelf%3Ftab%3Dx');
    expect(signInPath('/')).toBe('/sign-in');
    expect(signInPath('/sign-in?next=/x')).toBe('/sign-in');
  });
});
