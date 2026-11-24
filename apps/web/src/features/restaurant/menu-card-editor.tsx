import type { MessOrderItem, MessOrderSection } from '@ss/contracts';
import { useRef, useState } from 'react';
import { ApiError, api, friendly } from '../../lib/api';
import { ArrowUp, PhotoIcon, Plus, Trash } from '../../shared/ui/icons';
import { shrinkPhoto } from './shared';

const blankItem = (): MessOrderItem => ({ name: '', price: 0, note: '', photo: '', available: true });

const iconBtn =
  'grid place-items-center w-9 h-9 rounded-full text-ink2 hover:text-ink hover:bg-sunk disabled:opacity-30 disabled:hover:bg-transparent';

/** The item's photo: tap to add or change it; it's shrunk in the browser, then uploaded. */
function PhotoSlot({
  slug,
  photo,
  name,
  onChange,
}: { slug: string; photo: string; name: string; onChange: (photo: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { photo: saved } = await api.ownerUploadPhoto(slug, await shrinkPhoto(file));
      onChange(saved);
    } catch (e) {
      setError(e instanceof ApiError ? friendly(e) : e instanceof Error ? e.message : friendly(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const src = api.messPhotoUrl(slug, photo);
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        aria-label={
          photo ? `Change the photo of ${name || 'this item'}` : `Add a photo of ${name || 'this item'}`
        }
        className="relative w-[84px] h-[84px] sm:w-24 sm:h-24 rounded-2xl overflow-hidden bg-sunk grid place-items-center text-ink2 hover:text-ink [box-shadow:inset_0_0_0_1.5px_var(--line)] hover:[box-shadow:inset_0_0_0_1.5px_var(--ink2)]"
      >
        {src ? (
          <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[11px] font-semibold">
            <PhotoIcon size={22} />
            Add photo
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-bg/70 text-[12px] font-semibold text-ink">
            Uploading…
          </span>
        )}
      </button>
      {photo && !busy && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-[12px] font-semibold text-ink2 underline underline-offset-2 hover:text-ink"
        >
          Remove
        </button>
      )}
      {error && (
        <span role="alert" className="max-w-[110px] text-center text-[11px] leading-tight text-blush-text">
          {error}
        </span>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  );
}

/** One dish on the card: photo, name, price, a short note, and "sold out". */
function ItemRow({
  slug,
  item,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  slug: string;
  item: MessOrderItem;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<MessOrderItem>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = item.name || 'this item';
  return (
    <li
      className={`flex gap-3 sm:gap-4 py-4 ${item.available ? '' : 'opacity-70'}`}
      aria-label={item.name || 'New item'}
    >
      <PhotoSlot slug={slug} photo={item.photo} name={item.name} onChange={(photo) => onChange({ photo })} />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            value={item.name}
            maxLength={80}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="Dish name, e.g. Paneer butter masala"
            aria-label="Dish name"
            className="flex-1 min-w-0 h-11 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[16px] font-semibold text-ink outline-none focus:border-teal"
          />
          <label className="flex items-center h-11 w-[104px] shrink-0 rounded-xl bg-surface border-[1.5px] border-line px-3 focus-within:border-teal">
            <span className="text-[16px] font-semibold text-ink2" aria-hidden="true">
              ₹
            </span>
            <input
              value={item.price ? String(item.price) : ''}
              inputMode="numeric"
              maxLength={6}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, '').slice(0, 6));
                onChange({ price: Number.isFinite(n) ? n : 0 });
              }}
              placeholder="0"
              aria-label={`Price of ${label} in rupees`}
              className="w-full min-w-0 bg-transparent pl-1 text-[16px] font-semibold tabular-nums text-ink outline-none"
            />
          </label>
        </div>
        <input
          value={item.note}
          maxLength={80}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Short note (optional): half / full, serves 2, with curd…"
          aria-label={`Note for ${label}`}
          className="h-10 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[14px] text-ink outline-none focus:border-teal"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2.5 cursor-pointer text-[14px] font-semibold">
            <input
              type="checkbox"
              role="switch"
              aria-checked={item.available}
              checked={item.available}
              onChange={(e) => onChange({ available: e.target.checked })}
              className="peer sr-only"
              aria-label={`${label} is available`}
            />
            <span
              aria-hidden="true"
              className={`relative w-11 h-6 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-teal ${item.available ? 'bg-teal' : 'bg-line'}`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left] ${item.available ? 'left-[22px]' : 'left-0.5'}`}
              />
            </span>
            <span className={item.available ? 'text-ink' : 'text-blush-text'}>
              {item.available ? 'Available' : 'Sold out'}
            </span>
          </label>
          <span className="flex items-center">
            <button
              type="button"
              className={iconBtn}
              disabled={first}
              onClick={() => onMove(-1)}
              aria-label={`Move ${label} up`}
            >
              <ArrowUp size={17} />
            </button>
            <button
              type="button"
              className={iconBtn}
              disabled={last}
              onClick={() => onMove(1)}
              aria-label={`Move ${label} down`}
            >
              <ArrowUp size={17} className="rotate-180" />
            </button>
            <button type="button" className={iconBtn} onClick={onRemove} aria-label={`Delete ${label}`}>
              <Trash size={17} />
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

const move = <T,>(list: T[], i: number, by: -1 | 1) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

/**
 * The owner's menu card: sections ("Main course", "Breads") with the dishes students can order,
 * each with a photo, a price and a sold-out switch. Changes are kept until "Save changes".
 */
export function MenuCardEditor({
  slug,
  order,
  onChange,
}: { slug: string; order: MessOrderSection[]; onChange: (order: MessOrderSection[]) => void }) {
  const setSection = (si: number, patch: Partial<MessOrderSection>) =>
    onChange(order.map((s, i) => (i === si ? { ...s, ...patch } : s)));
  const setItem = (si: number, ii: number, patch: Partial<MessOrderItem>) =>
    setSection(si, { items: order[si]!.items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });
  const items = order.reduce((n, s) => n + s.items.length, 0);
  const soldOut = order.reduce((n, s) => n + s.items.filter((i) => !i.available).length, 0);

  return (
    <div className="flex flex-col gap-8">
      <p className="m-0 text-[15px] leading-relaxed text-ink2 max-w-[680px]">
        What students can order, with your prices. Add a photo to each dish: menus with photos get more
        orders. Switch a dish to <strong className="text-ink">Sold out</strong> when it runs out; it stays on
        the card but can't be ordered.{' '}
        <span className="tabular-nums">
          {items} dish{items === 1 ? '' : 'es'}
          {soldOut ? ` · ${soldOut} sold out` : ''}
        </span>
      </p>

      {order.map((section, si) => (
        <section
          // biome-ignore lint/suspicious/noArrayIndexKey: a key from the (changing) contents would remount the inputs and drop the cursor while typing.
          key={si}
          aria-label={section.title || 'New section'}
          className="flex flex-col border-t-2 border-ink pt-3"
        >
          <div className="flex items-center gap-2">
            <input
              value={section.title}
              maxLength={60}
              onChange={(e) => setSection(si, { title: e.target.value })}
              placeholder="Section name, e.g. Main course"
              aria-label="Section name"
              className="flex-1 min-w-0 h-12 bg-transparent font-display italic text-[24px] font-semibold text-ink outline-none border-b-[1.5px] border-transparent focus:border-teal"
            />
            <button
              type="button"
              className={iconBtn}
              disabled={si === 0}
              onClick={() => onChange(move(order, si, -1))}
              aria-label={`Move section ${section.title || ''} up`}
            >
              <ArrowUp size={17} />
            </button>
            <button
              type="button"
              className={iconBtn}
              onClick={() => {
                if (
                  !section.items.length ||
                  window.confirm(
                    `Delete "${section.title || 'this section'}" and its ${section.items.length} dishes?`,
                  )
                )
                  onChange(order.filter((_, i) => i !== si));
              }}
              aria-label={`Delete section ${section.title || ''}`}
            >
              <Trash size={17} />
            </button>
          </div>
          <ul className="m-0 p-0 list-none divide-y divide-line">
            {section.items.map((item, ii) => (
              <ItemRow
                // biome-ignore lint/suspicious/noArrayIndexKey: as above, so typing keeps its place.
                key={ii}
                slug={slug}
                item={item}
                first={ii === 0}
                last={ii === section.items.length - 1}
                onChange={(patch) => setItem(si, ii, patch)}
                onMove={(by) => setSection(si, { items: move(section.items, ii, by) })}
                onRemove={() => setSection(si, { items: section.items.filter((_, i) => i !== ii) })}
              />
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setSection(si, { items: [...section.items, blankItem()] })}
            disabled={section.items.length >= 60}
            className="self-start mt-2 inline-flex items-center gap-1.5 h-10 rounded-full border-[1.5px] border-dashed border-ink2/60 px-4 text-[14px] font-semibold text-ink hover:border-ink"
          >
            <Plus size={16} /> Add a dish to {section.title || 'this section'}
          </button>
        </section>
      ))}

      <button
        type="button"
        onClick={() => onChange([...order, { title: '', items: [blankItem()] }])}
        disabled={order.length >= 12}
        className="self-start inline-flex items-center gap-2 h-12 rounded-2xl border-[1.5px] border-dashed border-ink2/60 px-5 text-[15px] font-semibold text-ink hover:border-ink"
      >
        <Plus size={18} /> Add a section
      </button>
    </div>
  );
}

/** What's wrong with the card before saving (a dish without a name or price). */
export function menuCardProblems(order: MessOrderSection[]): string[] {
  const out: string[] = [];
  for (const [si, s] of order.entries()) {
    if (!s.title.trim()) out.push(`Section ${si + 1} needs a name.`);
    for (const it of s.items)
      if (!it.name.trim()) out.push(`A dish in "${s.title || `section ${si + 1}`}" has no name.`);
  }
  const names = order.flatMap((s) => s.items.map((i) => i.name.trim().toLowerCase())).filter(Boolean);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) out.push(`Two dishes are called "${dup}". Give each a different name.`);
  return out;
}
