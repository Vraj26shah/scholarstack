import type { OwnedMessDto } from '@ss/contracts';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Bell, Calendar, ChatBubble, ChevronLeft, Cross, Lock, PhotoIcon, User } from '../../shared/ui/icons';
import { OrderChat } from '../chat/order-chat';
import { OwnerFees } from '../fees/fee-statement';
import { AlertsCard, BlockedList, type EditorTab, Editors, TiffinSheet } from '../orders/orders-page';
import { Row, RowGroup } from '../student-app/app-ui';
import { type TextKey, setLang, useT } from './i18n';
import { bigButton } from './partner-app';
import { PartnerCustomers } from './partner-customers';
import { PhoneSetup } from './phone-setup';

export type MorePage =
  | 'tiffin'
  | 'customers'
  | 'offers'
  | 'photos'
  | 'week'
  | 'details'
  | 'blocked'
  | 'alerts'
  | 'fees';

const ITEMS: { key: MorePage; label: TextKey; hint: TextKey; icon: ReactNode }[] = [
  {
    key: 'alerts',
    label: 'moreAlerts',
    hint: 'hintAlerts',
    icon: <Bell size={22} />,
  },
  {
    key: 'photos',
    label: 'morePhotos',
    hint: 'hintPhotos',
    icon: <PhotoIcon size={22} />,
  },
  {
    key: 'offers',
    label: 'moreOffers',
    hint: 'hintOffers',
    icon: <span className="text-[19px] font-black leading-none">%</span>,
  },
  {
    key: 'tiffin',
    label: 'moreTiffin',
    hint: 'hintTiffin',
    icon: <Calendar size={22} />,
  },
  {
    key: 'customers',
    label: 'moreCustomers',
    hint: 'hintCustomers',
    icon: <User size={22} />,
  },
  {
    key: 'week',
    label: 'moreWeek',
    hint: 'hintWeek',
    icon: <Calendar size={22} />,
  },
  {
    key: 'details',
    label: 'moreDetails',
    hint: 'hintDetails',
    icon: <ChatBubble size={22} />,
  },
  {
    key: 'fees',
    label: 'moreFees',
    hint: 'hintFees',
    icon: <span className="text-[19px] font-black leading-none">₹</span>,
  },
  {
    key: 'blocked',
    label: 'moreBlocked',
    hint: 'hintBlocked',
    icon: <Lock size={22} />,
  },
];

const EDITOR: Partial<Record<MorePage, EditorTab>> = {
  photos: 'menu',
  offers: 'offers',
  week: 'week',
  details: 'details',
};

/** "More": every part of the owner's dashboard, opened inside the app with a back button. */
export function PartnerMore({ mess }: { mess: OwnedMessDto }) {
  const { t, lang } = useT();
  const [params, setParams] = useSearchParams();
  const page = ITEMS.find((i) => i.key === params.get('page'))?.key ?? null;
  const open = (p: MorePage | null) => setParams(p ? { tab: 'more', page: p } : { tab: 'more' });
  const [chat, setChat] = useState<string | null>(null);

  if (page) {
    const item = ITEMS.find((i) => i.key === page)!;
    const editor = EDITOR[page];
    return (
      <div className="flex flex-col gap-5">
        <button
          type="button"
          onClick={() => open(null)}
          className="self-start -ml-2 inline-flex items-center gap-1 h-11 px-2 rounded-xl text-[16px] font-bold text-ink2 hover:text-ink"
        >
          <ChevronLeft size={22} /> {t('tabMore')}
        </button>
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-[26px] font-extrabold tracking-[-0.02em] leading-tight">{t(item.label)}</h2>
          <p className="m-0 text-[15px] text-ink2">{t(item.hint)}</p>
        </div>
        {/* The dashboard's own sections: the same saving and checks as on the website. */}
        <div className="partner-embed min-w-0">
          {page === 'alerts' && (
            <div className="flex flex-col gap-4">
              <AlertsCard />
              <PhoneSetup />
            </div>
          )}
          {page === 'tiffin' && <TiffinSheet mess={mess} onChat={setChat} />}
          {page === 'customers' && <PartnerCustomers mess={mess} />}
          {page === 'blocked' && <BlockedList mess={mess} />}
          {page === 'fees' && <OwnerFees mess={mess} />}
          {editor && <Editors key={`${mess.slug}-${editor}`} tab={editor} mess={mess} />}
        </div>
        {chat && <OrderChat orderId={chat} asOwner onClose={() => setChat(null)} />}
      </div>
    );
  }

  const groups: { title: TextKey; keys: MorePage[] }[] = [
    { title: 'groupToday', keys: ['alerts', 'tiffin', 'customers'] },
    { title: 'groupMenu', keys: ['photos', 'week', 'offers'] },
    { title: 'groupShop', keys: ['details', 'fees', 'blocked'] },
  ];
  return (
    <div className="flex flex-col gap-7 pt-1">
      {groups.map((g) => (
        <RowGroup key={g.title} title={t(g.title)}>
          {g.keys.map((k) => {
            const x = ITEMS.find((i) => i.key === k)!;
            return <Row key={k} onClick={() => open(k)} icon={x.icon} title={t(x.label)} hint={t(x.hint)} />;
          })}
        </RowGroup>
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="m-0 text-[14px] font-extrabold uppercase tracking-[0.08em] text-ink2">
          {t('language')}
        </h2>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-sunk p-1">
          {(['hi', 'en'] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`min-h-12 rounded-xl text-[17px] font-bold ${lang === l ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--line)]' : 'text-ink2'}`}
            >
              {l === 'hi' ? 'हिंदी' : 'English'}
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <a href="/contact" className={`${bigButton('outline')} no-underline`}>
          {t('support')}
        </a>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t('logoutSure'))) void useSession.getState().signOut();
          }}
          className={`${bigButton('ghost')} text-blush-text`}
        >
          <Cross size={18} /> {t('logout')}
        </button>
      </div>
    </div>
  );
}
