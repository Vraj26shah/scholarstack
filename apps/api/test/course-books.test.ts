import { describe, expect, it, vi } from 'vitest';
import { fetchCover, lookupIsbn } from '../src/application/book-lookup';
import { looksLikeBookTitle } from '../src/application/catalogue-service';
import { Browser, setup } from './harness';

type App = ReturnType<typeof setup>['app'];
async function admin(app: App) {
  const a = new Browser(app);
  await a.signIn('admin@vitbhopal.ac.in');
  return a;
}

describe('recommended books', () => {
  it('lets an admin delete a discovered reference-book source from the course book page', async () => {
    const { app, env } = setup();
    const a = await admin(app);
    const course = [...env.db.courses.values()].find((c) => c.slug === 'os-2025-cse-core')!;
    const sourceFile = [...env.db.files.values()].find((file) => file.courseId === course.id)!;
    const sourceKey = `${course.r2Prefix}Reference books/Operating System Concepts 9th Edition.pdf`;
    env.db.files.set('found-reference-book', {
      ...sourceFile,
      id: 'found-reference-book',
      unitKey: 'reference-books',
      unitTitle: 'Reference books',
      unitKind: 'reference',
      unitSort: 7000,
      unitHidden: true,
      hidden: true,
      name: 'Operating System Concepts 9th Edition.pdf',
      sizeBytes: 1,
      pageCount: 0,
      sourceKey,
      conversionStatus: 'pending',
      previewKey: null,
    });
    env.sources.put(sourceKey, new Uint8Array([1]), 'application/pdf', 'ref-test', 1);
    const base = `/admin/courses/${course.id}/books`;
    const books = await a.call('GET', base);
    const found = books.json.found.find(
      (book: any) => book.title === 'Operating System Concepts 9th Edition',
    );

    expect(found.sourceKeys).toHaveLength(1);
    const deleted = await a.call('POST', '/admin/storage-tree/delete', {
      paths: found.sourceKeys,
      confirm: 'DELETE',
    });
    expect(deleted.status).toBe(200);

    const refreshed = await a.call('GET', base);
    expect(refreshed.json.found.some((book: any) => book.title === found.title)).toBe(false);
  });

  it('an admin adds, edits, orders and removes books; students see the list at once', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const a = await admin(app);
    const base = `/admin/courses/${course.id}/books`;

    let r = (
      await a.call('POST', base, {
        title: 'Database System Concepts',
        author: 'Silberschatz',
        url: 'https://www.amazon.in/dp/9390727502',
      })
    ).json;
    expect(r.books).toHaveLength(1);
    r = (await a.call('POST', base, { title: 'Fundamentals of DBMS', url: 'https://openlibrary.org/x' }))
      .json;
    expect(r.books.map((b: any) => b.title)).toEqual(['Database System Concepts', 'Fundamentals of DBMS']);

    // Same title twice, a non-web link, or no name are refused with a plain message.
    expect(
      (await a.call('POST', base, { title: 'database system concepts', url: 'https://a.in' })).status,
    ).toBe(400);
    expect((await a.call('POST', base, { title: 'Bad', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await a.call('POST', base, { title: '', url: 'https://a.in' })).status).toBe(400);

    const [first, second] = r.books;
    r = (await a.call('PUT', `${base}/order`, { ids: [second.id, first.id] })).json;
    expect(r.books[0].id).toBe(second.id);
    r = (
      await a.call('PUT', `/admin/books/${second.id}`, {
        title: 'Fundamentals of Database Systems',
        author: 'Elmasri',
        url: 'https://openlibrary.org/y',
      })
    ).json;
    expect(r.books[0]).toMatchObject({ title: 'Fundamentals of Database Systems', author: 'Elmasri' });

    const detail = (await new Browser(app).call('GET', `/courses/${course.slug}`)).json;
    expect(detail.readingList).toMatchObject([
      {
        title: 'Fundamentals of Database Systems',
        unit: 'Elmasri',
        findUrl: 'https://openlibrary.org/y',
        linkLabel: 'openlibrary.org',
      },
      {
        title: 'Database System Concepts',
        unit: 'Silberschatz',
        findUrl: 'https://www.amazon.in/dp/9390727502',
        linkLabel: 'amazon.in',
      },
    ]);

    await a.call('DELETE', `/admin/books/${second.id}`);
    r = (await a.call('DELETE', `/admin/books/${first.id}`)).json;
    expect(r.books).toEqual([]);
    expect((await new Browser(app).call('GET', `/courses/${course.slug}`)).json.readingList).toEqual([]);
  });

  it('a book can have an ISBN and a free legal copy; students get exact links and the free copy first', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!;
    const a = await admin(app);
    const base = `/admin/courses/${course.id}/books`;
    // An ISBN alone is enough: typed with dashes, saved as digits, linked to its Open Library page.
    const one = await a.call('POST', base, {
      title: 'Database System Concepts',
      author: 'Silberschatz, Korth & Sudarshan',
      isbn: '978-0-07-802215-9',
    });
    expect(one.status).toBe(200);
    expect(one.json.books[0]).toMatchObject({
      isbn: '9780078022159',
      url: 'https://openlibrary.org/isbn/9780078022159',
      freeUrl: null,
      freeKind: null,
    });
    // A free copy alone is enough too.
    await a.call('POST', base, {
      title: 'Database Design, 2nd Edition',
      author: 'Adrienne Watt',
      freeUrl: 'https://opentextbc.ca/dbdesign01/',
      freeKind: 'read',
    });
    // Nothing to find it by, a bad ISBN, or a plain-http free link: refused with a reason.
    expect((await a.call('POST', base, { title: 'Nowhere Book' })).status).toBe(400);
    expect((await a.call('POST', base, { title: 'Bad ISBN', isbn: '12345' })).status).toBe(400);
    expect(
      (await a.call('POST', base, { title: 'Plain http', freeUrl: 'http://example.com/book.pdf' })).status,
    ).toBe(400);

    const student = new Browser(app);
    const list = (await student.call('GET', `/courses/${course.slug}`)).json.readingList;
    expect(list[0]).toMatchObject({
      title: 'Database System Concepts',
      author: 'Silberschatz, Korth & Sudarshan',
      isbn: '9780078022159',
      links: [
        { label: 'Preview', url: 'https://books.google.com/books?vid=ISBN9780078022159' },
        { label: 'Borrow free', url: 'https://openlibrary.org/isbn/9780078022159' },
        { label: 'Buy', url: 'https://www.amazon.in/s?k=9780078022159&i=stripbooks' },
      ],
    });
    expect(list[0].free).toBeUndefined();
    expect(list[0].linkLabel).toBeUndefined(); // the Open Library page isn't shown as "Get it on…"
    expect(list[1]).toMatchObject({
      title: 'Database Design, 2nd Edition',
      free: { url: 'https://opentextbc.ca/dbdesign01/', kind: 'read' },
      findUrl: 'https://opentextbc.ca/dbdesign01/',
      links: [],
    });
  });

  it('titles guessed from file names that aren’t books are left out', () => {
    expect(looksLikeBookTitle('Discrete Mathematical Structures Kolman')).toBe(true);
    expect(looksLikeBookTitle('Module 2 Handwritten notes')).toBe(false);
    expect(looksLikeBookTitle('Reference book')).toBe(false);
    expect(looksLikeBookTitle('Probability')).toBe(false);
    expect(looksLikeBookTitle('DataStructures')).toBe(false);
  });

  it('covers and ISBN look-ups come from Open Library, and only for real ISBNs', async () => {
    const fake = vi.fn(async (url: string) => {
      if (url.includes('covers.openlibrary.org'))
        return new Response(new Uint8Array(5000), { headers: { 'content-type': 'image/jpeg' } });
      return Response.json({
        'ISBN:9780131103627': {
          title: 'The C Programming Language',
          authors: [{ name: 'Brian W. Kernighan' }, { name: 'Dennis M. Ritchie' }],
        },
      });
    }) as unknown as typeof fetch;
    expect((await fetchCover('978-0131103627', fake))?.type).toBe('image/jpeg');
    expect(await fetchCover('not-an-isbn', fake)).toBeNull();
    expect(await lookupIsbn('9780131103627', fake)).toEqual({
      isbn: '9780131103627',
      title: 'The C Programming Language',
      author: 'Brian W. Kernighan, Dennis M. Ritchie',
    });
    expect(await lookupIsbn('../../etc/passwd', fake)).toBeNull();
    // Only the two Open Library addresses were ever asked for.
    for (const [url] of (fake as unknown as { mock: { calls: [string][] } }).mock.calls)
      expect(url).toMatch(/^https:\/\/(covers\.)?openlibrary\.org\//);
    // A missing cover (404, or a 1x1 placeholder) is no cover.
    const none = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    expect(await fetchCover('9780131103627', none)).toBeNull();
  });

  it('students cannot manage books', async () => {
    const { app, env } = setup();
    const course = [...env.db.courses.values()][0]!;
    const s = new Browser(app);
    await s.signIn('student@vitbhopal.ac.in');
    expect(
      (await s.call('POST', `/admin/courses/${course.id}/books`, { title: 'X book', url: 'https://a.in' }))
        .status,
    ).toBe(403);
  });
});

describe('public catalogue freshness', () => {
  it('an admin edit shows on the public catalogue at once, despite the short read cache', async () => {
    const { app, env } = setup();
    const browse = () => new Browser(app).call('GET', '/catalogue/drawer?batch=2025&branch=bce');
    expect((await browse()).json.some((c: any) => c.title === 'DBMS (renamed)')).toBe(false);
    const a = await admin(app);
    const id = [...env.db.courses.values()].find((c) => c.slug === 'dbms-2025-cse-core')!.id;
    expect(
      (await a.call('PATCH', `/admin/courses/${id}`, { title: 'DBMS (renamed)', status: 'live' })).status,
    ).toBe(200);
    expect((await browse()).json.some((c: any) => c.title === 'DBMS (renamed)')).toBe(true);
  });
});
