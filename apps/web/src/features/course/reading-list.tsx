import type { ReadingItemDto } from '@ss/contracts';
import { useState } from 'react';
import { env } from '../../lib/env';

/**
 * Books to keep beside the notes. They are not part of what we sell, so each one links to legal
 * places only: a free copy when one exists (an open textbook, or one its authors publish free),
 * otherwise a look inside on Google Books, a free loan on Open Library, and a shop. Never a
 * pirated copy.
 */

const cover = (isbn: string) => `${env.apiBase.replace(/\/+$/, '')}/covers/${isbn}`;
const SPINES = ['bg-brand', 'bg-teal', 'bg-[#7a4e9c]', 'bg-[#a4503c]', 'bg-[#3d6b4f]'];
const initials = (title: string) =>
  title
    .replace(/[^a-z0-9 ]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(the|and|for|with|using)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
const spineOf = (title: string) =>
  SPINES[[...title].reduce((s, ch) => s + ch.charCodeAt(0), 0) % SPINES.length]!;

/** The real cover when Open Library has one, faded in over a neat spine (shown while it loads, or if there's none). */
function Cover({ item }: { item: ReadingItemDto }) {
  const [state, setState] = useState<'loading' | 'shown' | 'none'>(item.isbn ? 'loading' : 'none');
  const free = !!item.free;
  return (
    <span className="relative flex-none w-16 h-24">
      <span
        aria-hidden="true"
        className={`absolute inset-0 rounded-[3px_6px_6px_3px] ${free ? 'bg-teal' : spineOf(item.title)} text-white flex flex-col items-center justify-between py-2 shadow-[inset_5px_0_0_rgba(255,255,255,0.18),2px_3px_8px_rgba(0,0,0,0.12)]`}
      >
        <span className="font-display font-extrabold text-[17px] tracking-[-0.02em]">
          {initials(item.title) || '§'}
        </span>
        {free && <span className="font-mono text-[9px] tracking-[0.12em]">FREE</span>}
      </span>
      {item.isbn && state !== 'none' && (
        <img
          src={cover(item.isbn)}
          alt=""
          loading="lazy"
          decoding="async"
          width={64}
          height={96}
          onLoad={() => setState('shown')}
          onError={() => setState('none')}
          className={`absolute inset-0 w-16 h-24 rounded-[3px_6px_6px_3px] object-cover shadow-[0_1px_0_var(--line),2px_3px_8px_rgba(0,0,0,0.12)] transition-opacity duration-300 motion-reduce:transition-none ${
            state === 'shown' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </span>
  );
}

const primary =
  'inline-flex items-center gap-1 h-8 rounded-full px-3 text-[13px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2';
const secondary =
  'text-[12.5px] font-semibold text-teal-text no-underline hover:underline focus-visible:underline';

function Book({ item }: { item: ReadingItemDto }) {
  const author = item.author ?? item.unit;
  // The first place to go: the free copy, else a look inside (or the admin's own shop link).
  const main = item.free
    ? { label: item.free.kind === 'pdf' ? 'Download free PDF' : 'Read free online', url: item.free.url }
    : item.linkLabel
      ? { label: `Get it on ${item.linkLabel}`, url: item.findUrl }
      : (item.links?.[0] ?? { label: 'Find a copy', url: item.findUrl });
  const rest = (item.free || item.linkLabel ? (item.links ?? []) : (item.links ?? []).slice(1)).filter(
    (l) => l.url !== main.url,
  );
  return (
    <li className="flex gap-3.5 rounded-2xl border border-line bg-surface p-3.5 min-w-0">
      <Cover item={item} />
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="font-semibold leading-snug line-clamp-2">{item.title}</span>
        {author && <span className="text-[13px] text-ink2 line-clamp-1">{author}</span>}
        <div className="mt-auto pt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <a
            href={main.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${main.label}: ${item.title} (opens in a new tab)`}
            className={`${primary} ${
              item.free
                ? 'bg-teal text-white hover:brightness-110'
                : 'border border-line text-ink hover:border-teal'
            }`}
          >
            {main.label} <span aria-hidden="true">↗</span>
          </a>
          {rest.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${l.label}: ${item.title} (opens in a new tab)`}
              className={secondary}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>
    </li>
  );
}

export function ReadingList({ items }: { items: ReadingItemDto[] }) {
  if (items.length === 0) return null;
  const free = items.filter((b) => b.free);
  const others = items.filter((b) => !b.free);
  const group = (title: string, note: string, list: ReadingItemDto[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h4 className="m-0 text-[15px] font-semibold">{title}</h4>
          <span className="text-[13px] text-ink2">{note}</span>
        </div>
        <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
          {list.map((b) => (
            <Book key={`${b.title}|${b.author ?? b.unit}`} item={b} />
          ))}
        </ul>
      </div>
    );
  return (
    <section aria-labelledby="books-title" className="mt-10 flex flex-col gap-5">
      <div>
        <h3
          id="books-title"
          className="m-0 font-display font-extrabold text-[26px] tracking-[-0.04em] leading-none"
        >
          Books for this course
        </h3>
        <p className="m-0 mt-2 text-sm leading-relaxed text-ink2 max-w-[640px]">
          The standard textbooks, and the best free ones. Free books are open textbooks or published free by
          their authors, so they're yours to read and download. Textbooks aren't part of the course: preview
          them, borrow one free, or get a copy.
        </p>
      </div>
      {group('Free to read and download', 'legal, no sign-up', free)}
      {group('Textbooks', 'preview, borrow or buy', others)}
    </section>
  );
}
