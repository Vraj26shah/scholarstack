import type { MessDto, MessOrderSection, OwnedMessDto, OwnerMessInput } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Skeleton } from '../../shared/ui/feedback';
import { PhotoIcon } from '../../shared/ui/icons';
import { useT } from './i18n';
import { bigButton } from './partner-app';

/** The fields the owner's save takes, from the restaurant as loaded. */
export const ownerForm = (m: MessDto): OwnerMessInput => ({
  name: m.name,
  place: m.place,
  note: m.note,
  prices: m.prices,
  phone: m.phone,
  orderNote: m.orderNote,
  order: m.order,
  meals: m.meals,
  weeks: m.weeks,
  cycleStart: m.cycleStart,
  dailyOrderCap: m.dailyOrderCap ?? 0,
  offers: m.offers ?? [],
});

/** Sold out / available for each dish, and quick price changes. One Save for everything. */
export function PartnerMenu({ mess }: { mess: OwnedMessDto }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['owner-mess', mess.slug], queryFn: () => api.ownerMess(mess.slug) });
  const [draft, setDraft] = useState<MessOrderSection[] | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const sections = draft ?? q.data?.order ?? [];
  const dirty = draft !== null;

  const save = useMutation({
    mutationFn: () => api.ownerSaveMess(mess.slug, { ...ownerForm(q.data!), order: sections }),
    onSuccess: (m) => {
      qc.setQueryData(['owner-mess', mess.slug], m);
      setDraft(null);
      setSavedAt(Date.now());
    },
  });

  const change = (si: number, ii: number, patch: { available?: boolean; price?: number }) =>
    setDraft(
      sections.map((s, a) =>
        a !== si ? s : { ...s, items: s.items.map((it, b) => (b !== ii ? it : { ...it, ...patch })) },
      ),
    );

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
        <Skeleton className="h-20 rounded-2xl" />
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[16px] leading-relaxed text-ink2">{t('menuHint')}</p>
        <Link
          to="/partner?tab=more&page=photos"
          className={`${bigButton('outline')} min-h-12 text-[16px] no-underline`}
        >
          <PhotoIcon size={18} /> {t('editMenu')}
        </Link>
      </div>
      {sections.map((s, si) => (
        <section key={s.title} className="flex flex-col gap-2">
          <h2 className="m-0 text-[15px] font-extrabold uppercase tracking-[0.08em] text-ink2">{s.title}</h2>
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {s.items.map((it, ii) => (
              <li
                key={`${it.name}-${ii}`}
                className={`flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-[0_0_0_1px_var(--line)] ${it.available ? '' : 'opacity-70'}`}
              >
                <div className="flex-1 min-w-0">
                  <p
                    className={`m-0 text-[18px] font-bold leading-snug [overflow-wrap:anywhere] ${it.available ? '' : 'line-through decoration-2'}`}
                  >
                    {it.name}
                  </p>
                  <label className="mt-1 inline-flex items-center gap-1.5 text-[14px] text-ink2">
                    {t('price')}
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100000}
                      value={it.price}
                      onChange={(e) =>
                        change(si, ii, {
                          price: Math.max(0, Math.min(100000, Math.floor(Number(e.target.value) || 0))),
                        })
                      }
                      className="w-20 h-9 rounded-lg bg-sunk px-2 font-mono text-[16px] text-ink outline-none focus:ring-2 focus:ring-teal"
                    />
                  </label>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={it.available}
                  aria-label={`${it.name}: ${it.available ? t('available') : t('soldOut')}`}
                  onClick={() => change(si, ii, { available: !it.available })}
                  className={`flex-none min-w-[108px] min-h-12 rounded-xl px-3 text-[15px] font-extrabold ${it.available ? 'bg-[#e3f4ea] text-[#14532d] dark:bg-[#123222] dark:text-[#b8f0cc]' : 'bg-blush text-blush-text'}`}
                >
                  {it.available ? t('available') : t('soldOut')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {(dirty || save.isPending) && (
        <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 px-4">
          <div className="max-w-[720px] mx-auto flex items-center gap-3 rounded-2xl bg-ink text-bg p-3 shadow-xl">
            <span className="flex-1 text-[15px] font-semibold pl-1">{t('unsaved')}</span>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="h-12 px-4 rounded-xl text-[15px] font-bold text-bg/80"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className={`${bigButton('accept')} min-h-12 text-[16px]`}
            >
              {save.isPending ? t('pleaseWait') : t('save')}
            </button>
          </div>
        </div>
      )}
      {save.isError && (
        <p role="alert" className="m-0 text-[15px] font-semibold text-blush-text">
          {(save.error as Error).message}
        </p>
      )}
      {!dirty && savedAt > 0 && Date.now() - savedAt < 5000 && (
        <p role="status" className="m-0 text-[15px] font-bold text-[#1f8a4c]">
          ✓ {t('saved')}
        </p>
      )}
    </div>
  );
}
