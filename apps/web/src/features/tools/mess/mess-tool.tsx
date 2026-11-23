import { DAY_KEYS, MEAL_KEYS, type MealKey, campusClock } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { ErrorState, Skeleton } from '../../../shared/ui/feedback';
import { ReminderPrompt } from '../../reminders/reminder-prompt';
import { useLocalReminders } from '../../reminders/settings-store';
import { useToolState } from '../core/storage';
import { ToolHeader } from '../core/ui';
import { DayStrip, MenuDay, weekDates } from './components/menu-day';
import { MessAbout } from './components/mess-about';
import { MessPicker } from './components/mess-picker';
import { ReportForm } from './components/report-form';

/** The campus clock, ticking each minute so "Serving now" and "In 20 min" stay true. */
function useCampusClock() {
  const [now, setNow] = useState(() => campusClock(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setNow(campusClock(new Date())), 60_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** Pick a mess once; see today's meals first, any day of the week a tap away. */
export default function MessTool() {
  const [params, setParams] = useSearchParams();
  const [choice, setChoice] = useToolState<string | null>('mess_choice', null);
  const clock = useCampusClock();
  const dates = useMemo(() => weekDates(clock.date, clock.day), [clock.date, clock.day]);
  const [date, setDate] = useState(clock.date);
  const favourites = useLocalReminders().mess.favourites;

  // A tap on a reminder opens ?mess=…&meal=…: that mess, today, that meal highlighted.
  const linked = params.get('mess');
  const focusParam = params.get('meal');
  const focus = MEAL_KEYS.includes(focusParam as MealKey) ? (focusParam as MealKey) : null;
  useEffect(() => {
    if (linked && linked !== choice) setChoice(linked);
  }, [linked, choice, setChoice]);

  const list = useQuery({ queryKey: ['messes'], queryFn: api.messes, staleTime: 5 * 60_000 });
  const slug = choice && list.data?.some((m) => m.slug === choice) ? choice : null;
  const mess = useQuery({
    queryKey: ['mess', slug],
    queryFn: () => api.mess(slug!),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (focus && mess.data) document.getElementById(`meal-${focus}`)?.scrollIntoView({ block: 'center' });
  }, [focus, mess.data]);

  const pick = (s: string) => {
    setChoice(s);
    setDate(clock.date);
    if (params.has('mess') || params.has('meal')) setParams({}, { replace: true });
  };

  return (
    <div className="flex flex-col gap-8">
      <ToolHeader
        title="Mess menu"
        lead="What's on at your hostel mess or day-scholar restaurant today, and the rest of the week."
        footnote="Your mess choice stays on this device."
      />

      {list.isLoading ? (
        <Skeleton className="h-14 max-w-[520px]" />
      ) : list.isError ? (
        <ErrorState
          title="Couldn't load the menus"
          message="Check your connection and try again."
          onRetry={() => list.refetch()}
        />
      ) : (
        <MessPicker messes={list.data ?? []} value={slug} onChange={pick} />
      )}

      {!slug && list.data && (
        <div className="flex flex-col gap-2 max-w-[640px] text-[15px] leading-relaxed text-ink2">
          <p className="m-0">
            <strong className="text-ink">Hosteller?</strong> Pick your hostel's mess: breakfast, lunch, high
            tea and dinner.
          </p>
          <p className="m-0">
            <strong className="text-ink">Day scholar?</strong> Pick a restaurant near campus: lunch and
            dinner, with the owner's prices.
          </p>
        </div>
      )}

      {slug && mess.isLoading && <Skeleton className="h-80" />}
      {slug && mess.isError && (
        <ErrorState
          title="Couldn't load this menu"
          message="Check your connection and try again."
          onRetry={() => mess.refetch()}
        />
      )}

      {mess.data && (
        <>
          <MessAbout mess={mess.data} />
          <div className="flex flex-col gap-4">
            <DayStrip dates={dates} today={clock.date} value={date} onChange={setDate} />
            <MenuDay
              mess={mess.data}
              date={date}
              isToday={date === clock.date}
              nowMinutes={clock.minutes}
              focus={date === clock.date ? focus : null}
              favourites={favourites}
            />
          </div>

          <ReminderPrompt context={{ kind: 'mess', slug: mess.data.slug, name: mess.data.name }} />

          <section
            id="mess-report"
            aria-labelledby="mess-report-h"
            className="scroll-mt-24 flex flex-col gap-3"
          >
            <h2 id="mess-report-h" className="m-0 text-[18px] font-bold text-ink">
              Something changed? Tell us
            </h2>
            <p className="m-0 max-w-[640px] text-[15px] leading-relaxed text-ink2">
              Menus change. If what's served (or what it costs) doesn't match this page, tell us and we'll
              update it for everyone.
            </p>
            <ReportForm mess={mess.data} day={DAY_KEYS[dates.indexOf(date)] ?? 'mon'} />
          </section>
        </>
      )}
    </div>
  );
}
