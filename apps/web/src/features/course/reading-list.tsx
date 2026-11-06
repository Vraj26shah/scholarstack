import type { ReadingItemDto } from '@ss/contracts';

/**
 * Books to keep beside the notes. These are published textbooks, so they are not part of what
 * we sell: each card links to where to get a copy (the admin's link, or a library search).
 */
export function ReadingList({ items }: { items: ReadingItemDto[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="books-title" className="mt-10">
      <h3
        id="books-title"
        className="m-0 font-display font-extrabold text-[26px] tracking-[-0.04em] leading-none"
      >
        Recommended books
      </h3>
      <p className="m-0 mt-2 mb-4 text-sm leading-relaxed text-ink2 max-w-[640px]">
        Books that go well with these notes. They are not included in the course: borrow them from the library
        or get your own copy.
      </p>
      <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {items.map((b) => (
          <li key={b.title}>
            <a
              href={b.findUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group h-full flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 no-underline text-ink transition-colors hover:border-teal focus-visible:border-teal"
            >
              <span
                aria-hidden="true"
                className="flex-none w-8 h-11 rounded-[3px_7px_7px_3px] bg-brand shadow-[inset_4px_0_0_rgba(255,255,255,0.2)]"
              />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold leading-snug line-clamp-2">{b.title}</span>
                {b.linkLabel && b.unit && <span className="text-[13px] text-ink2 truncate">{b.unit}</span>}
                <span className="mt-1 text-[13px] font-semibold text-teal-text group-hover:underline">
                  {b.linkLabel ? `Get it on ${b.linkLabel}` : 'Find a copy'} ↗
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
