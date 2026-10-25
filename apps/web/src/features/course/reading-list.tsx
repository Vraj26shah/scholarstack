import type { ReadingItemDto } from '@ss/contracts';

/**
 * Books that sat in the course folder but are not part of what we sell (publishers' textbooks).
 * Only their titles are shown, with a link to find a legal copy; the files are never served.
 */
export function ReadingList({ items }: { items: ReadingItemDto[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="books-title" className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h3
          id="books-title"
          className="m-0 font-display font-extrabold text-[26px] tracking-[-0.04em] leading-none"
        >
          Recommended books
        </h3>
        <span className="text-sm text-ink2">Not included · find a copy</span>
      </div>
      <p className="m-0 mb-4 text-sm leading-relaxed text-ink2 max-w-[640px]">
        Seniors kept these books alongside their notes. They are published textbooks, so they are not part of
        this course: borrow them from the VIT Bhopal library or get your own copy.
      </p>
      <ul className="list-none m-0 p-0 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
        {items.map((b) => (
          <li
            key={b.title}
            className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-3.5"
          >
            <span
              aria-hidden="true"
              className="flex-none w-9 h-12 rounded-[4px_8px_8px_4px] bg-brand shadow-[inset_4px_0_0_rgba(255,255,255,0.18)]"
            />
            <span className="flex flex-col gap-1 min-w-0">
              <span className="font-semibold leading-snug">{b.title}</span>
              <span className="font-mono text-[11px] text-ink2 uppercase">{b.unit}</span>
              <a
                href={b.findUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-semibold text-teal-text"
              >
                Find a copy ↗
              </a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
