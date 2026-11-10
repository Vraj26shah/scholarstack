import type { ReadingItemDto } from '@ss/contracts';

const chip =
  'inline-flex items-center rounded-full border border-line px-2.5 py-1 text-[12.5px] font-semibold text-teal-text no-underline hover:border-teal hover:underline focus-visible:border-teal';

/**
 * Books to keep beside the notes. These are published textbooks, so they are not part of what
 * we sell: each card links to legal places to get a copy (the admin's own link first, then free
 * borrowing on Open Library, a look inside on Google Books, and buying on Amazon).
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
        Books that go well with these notes. They are not included in the course: borrow one free online, look
        inside, or get your own copy.
      </p>
      <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {items.map((b) => {
          const links = [
            ...(b.linkLabel ? [{ label: `Get it on ${b.linkLabel}`, url: b.findUrl }] : []),
            ...(b.links ?? (b.linkLabel ? [] : [{ label: 'Find a copy', url: b.findUrl }])),
          ];
          return (
            <li
              key={b.title}
              className="h-full flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5"
            >
              <span
                aria-hidden="true"
                className="flex-none w-8 h-11 rounded-[3px_7px_7px_3px] bg-brand shadow-[inset_4px_0_0_rgba(255,255,255,0.2)]"
              />
              <span className="flex flex-col gap-0.5 min-w-0">
                <span className="font-semibold leading-snug line-clamp-2">{b.title}</span>
                {b.unit && <span className="text-[13px] text-ink2 truncate">{b.unit}</span>}
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {links.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={chip}
                      aria-label={`${l.label}: ${b.title} (opens in a new tab)`}
                    >
                      {l.label} ↗
                    </a>
                  ))}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
