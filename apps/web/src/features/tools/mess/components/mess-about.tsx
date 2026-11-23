import type { MessDto } from '@ss/contracts';
import { KIND_LABEL } from './mess-picker';

/**
 * Who serves it and how far to trust the menu. A notice-board menu is our own typing of a photo;
 * a restaurant's is shown exactly as the owner gave it, prices included. Either way, it's said
 * plainly that it may not match the plate, with a way to tell us.
 */
export function MessAbout({ mess }: { mess: MessDto }) {
  const owner = mess.source === 'owner';
  const meals = mess.meals.length === 4 ? 'four meals a day' : mess.meals.map((m) => m.key).join(' & ');
  return (
    <div className="flex flex-col gap-4 max-w-[760px]">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 font-display font-extrabold text-[clamp(26px,4vw,34px)] leading-none tracking-[-0.04em]">
          {mess.name}
        </h2>
        <p className="m-0 text-[15px] text-ink2">
          {KIND_LABEL[mess.kind]} · {meals}
          {mess.place ? ` · ${mess.place}` : ''}
        </p>
      </div>

      {owner && mess.prices && (
        <div className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink2">
            Prices from the owner
          </span>
          <p className="m-0 flex flex-wrap gap-2">
            {mess.prices.split('·').map((p) => (
              <span
                key={p}
                className="inline-flex items-center h-9 rounded-full bg-marigold-soft px-4 text-[15px] font-bold text-marigold-text"
              >
                {p.trim()}
              </span>
            ))}
          </p>
        </div>
      )}

      <div
        role="note"
        className="flex flex-col gap-1.5 border-l-4 border-marigold pl-4 text-[14px] leading-relaxed text-ink2"
      >
        <p className="m-0 text-ink">
          {owner ? (
            <>
              <strong>Menu as given by the owner.</strong> Dishes and prices can change, and the restaurant
              has the final word.
            </>
          ) : (
            <>
              <strong>This may not be exactly what's served.</strong> It's typed from the notice board, and
              the mess can swap a dish on the day.{' '}
              <span className="text-marigold-text font-semibold">Dishes marked ?</span> were hard to read.
            </>
          )}
        </p>
        {mess.note && <p className="m-0">{mess.note}</p>}
        <a
          href="#mess-report"
          className="self-start font-semibold text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
        >
          Something changed? Tell us
        </a>
      </div>
    </div>
  );
}
