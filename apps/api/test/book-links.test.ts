import { describe, expect, it } from 'vitest';
import { bookLinks, bookQuery } from '../src/application/catalogue-service';

describe('reading list links', () => {
  it('searches by name and author, without edition or file noise', () => {
    expect(bookQuery('Java How to Program Early Objects-10th ed Deitel Deitel')).toBe(
      'Java How to Program Early Objects Deitel',
    );
    expect(bookQuery('C The Complete Reference Fourth Edition')).toBe('C The Complete Reference');
    expect(bookQuery('Digital Design (Pearson, 2018) 5th Edition')).toBe('Digital Design');
  });

  it('only links to legal places to borrow, preview or buy', () => {
    const hosts = bookLinks('Digital Design').map((l) => new URL(l.url).host);
    expect(hosts).toEqual(['openlibrary.org', 'www.google.com', 'www.amazon.in']);
  });
});
