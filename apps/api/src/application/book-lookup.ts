import { ISBN_RE, normaliseIsbn } from '@ss/contracts';

type Fetch = typeof fetch;
const TIMEOUT = 8_000;

/**
 * A book cover from Open Library, fetched by our server so the site's strict image rules stay
 * as they are and students' browsers never talk to a third party. Null when there is none.
 */
export async function fetchCover(
  rawIsbn: string,
  fetcher: Fetch = fetch,
): Promise<{ body: ArrayBuffer; type: string } | null> {
  const isbn = normaliseIsbn(rawIsbn);
  if (!ISBN_RE.test(isbn)) return null;
  const res = await fetcher(`https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
    // Cloudflare keeps it at the edge for a month (ignored outside the Worker).
    cf: { cacheEverything: true, cacheTtl: 30 * 24 * 3600 },
  } as RequestInit);
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.startsWith('image/')) return null;
  const body = await res.arrayBuffer();
  // A real cover is a few kB to a few hundred; anything else isn't one.
  if (body.byteLength < 200 || body.byteLength > 2_000_000) return null;
  return { body, type };
}

/** Title and author(s) for an ISBN, from Open Library, to fill in the admin's form. */
export async function lookupIsbn(
  rawIsbn: string,
  fetcher: Fetch = fetch,
): Promise<{ isbn: string; title: string; author: string } | null> {
  const isbn = normaliseIsbn(rawIsbn);
  if (!ISBN_RE.test(isbn)) return null;
  const res = await fetcher(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`, {
    signal: AbortSignal.timeout(TIMEOUT),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as Record<
    string,
    { title?: string; subtitle?: string; authors?: { name?: string }[] }
  > | null;
  const book = data?.[`ISBN:${isbn}`];
  if (!book?.title) return null;
  const authors = (book.authors ?? []).map((a) => a.name?.trim()).filter(Boolean) as string[];
  return {
    isbn,
    title: (book.subtitle ? `${book.title}: ${book.subtitle}` : book.title).slice(0, 200),
    author: [...new Set(authors)].slice(0, 4).join(', ').slice(0, 120),
  };
}
