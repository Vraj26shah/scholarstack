import { DAY_KEYS, MEAL_KEYS, type MealKey, campusClock, weekIndex } from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../lib/api';
import { ErrorState, Skeleton } from '../../../shared/ui/feedback';
import { MealReminderSwitch, MealReminders } from '../../reminders/meal-reminders';
import { useLocalReminders } from '../../reminders/settings-store';
import { useToolState } from '../core/storage';
import { ToolHeader } from '../core/ui';
import { MealNow } from './components/meal-now';
import { DayStrip, MenuDay, weekDates } from './components/menu-day';
import { MessAbout } from './components/mess-about';
import { MessGrid } from './components/mess-grid';
import { MessPicker } from './components/mess-picker';
import { OrderPanel } from './components/order-panel';
import { ReportForm } from './components/report-form';

/** The campus clock, ticking each minute so "Serving now" and "In 20 min" stay true. */
function useCampusClock() {
  const [now, setNow] = useState(() => campusClock(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setNow(campusClock(new Date())), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const isPhone = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)').matches;

/**
 * The Mess menu, laid out like the Timetable maker: pick your mess once, see what's on now and
 * next, then the whole week as a grid (or one day at a time on a phone) with today and the current
 * meal highlighted. Restaurants add ordering; meal reminders sit right under the menu.
 */
export default function MessTool() {
  const [params, setParams] = useSearchParams();
  const [choice, setChoice] = useToolState<string | null>('mess_choice', null);
  const clock = useCampusClock();
  const dates = useMemo(() => weekDates(clock.date, clock.day), [clock.date, clock.day]);
  const tomorrow = useMemo(
    () => new Date(Date.parse(`${clock.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    [clock.date],
  );
  const [date, setDate] = useState(clock.date);
  const [view, setView] = useState<'week' | 'day'>(() => (isPhone() ? 'day' : 'week'));
  const reminders = useLocalReminders();
  const [reporting, setReporting] = useState(false);
  const openReport = () => {
    setReporting(true);
    window.setTimeout(
      () => document.getElementById('mess-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      0,
    );
  };
  const favourites = reminders.mess.favourites;

  // A tap on a reminder opens ?mess=…&meal=…: that mess, today, that meal outlined.
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
    // Switching mess keeps the old menu on screen until the new one arrives (no flash).
    placeholderData: (prev) => prev,
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

  const m = slug ? mess.data : undefined;
  const remindersFor = list.data?.find((x) => x.slug === reminders.mess.slug)?.name;
  const week = m ? weekIndex(m.cycleStart, clock.date, m.weeks.length) : 0;

  return (
    <div className="flex flex-col gap-6">
      <ToolHeader
        title="Mess menu"
        lead="Today's food at your hostel mess or day-scholar restaurant, and the rest of the week."
        footnote="Your mess choice stays on this device."
      />

      {!m && (
        <div className="flex flex-col gap-3">
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
            <div className="grid gap-6 sm:grid-cols-2 max-w-[760px] pt-2">
              {(
                [
                  ['Hosteller?', "Pick your hostel's mess: breakfast, lunch, high tea and dinner, all week."],
                  [
                    'Day scholar?',
                    "Pick a restaurant near campus: lunch and dinner, the owner's prices, and ordering.",
                  ],
                ] as const
              ).map(([t, body]) => (
                <div key={t} className="border-t-2 border-ink pt-3">
                  <p className="m-0 font-display text-[20px] font-bold text-ink">{t}</p>
                  <p className="m-0 mt-1 text-[14px] leading-relaxed text-ink2">{body}</p>
                </div>
              ))}
            </div>
          )}
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

      {m && (
        <>
          <MessAbout
            mess={m}
            onReport={openReport}
            picker={
              <div className="flex flex-wrap items-center gap-3 print:hidden">
                <MessPicker compact messes={list.data ?? []} value={slug} onChange={pick} />
                <MealReminderSwitch mess={m} />
              </div>
            }
          />

          <MealNow
            mess={m}
            date={clock.date}
            tomorrow={tomorrow}
            dayIndex={clock.day}
            nowMinutes={clock.minutes}
            favourites={favourites}
          />

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-[14px] text-ink2 print:hidden">
            <div role="tablist" aria-label="View" className="inline-flex rounded-full border border-line p-1">
              {(['week', 'day'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`h-8 rounded-full px-4 text-[13px] font-semibold ${view === v ? 'bg-ink text-bg' : 'text-ink2'}`}
                >
                  {v === 'week' ? 'Week' : 'Day'}
                </button>
              ))}
            </div>
            {m.weeks.length > 1 && (
              <span>
                <strong className="text-ink">{m.weeks[week]?.label || `Week ${week + 1}`}</strong> of{' '}
                {m.weeks.length}
              </span>
            )}
            {favourites.length > 0 && <span className="text-[13px]">⭐ your favourite</span>}
          </div>

          {view === 'week' ? (
            <MessGrid
              mess={m}
              dates={dates}
              today={clock.date}
              nowMinutes={clock.minutes}
              favourites={favourites}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <DayStrip dates={dates} today={clock.date} value={date} onChange={setDate} />
              <MenuDay
                mess={m}
                date={date}
                isToday={date === clock.date}
                nowMinutes={clock.minutes}
                focus={date === clock.date ? focus : null}
                favourites={favourites}
              />
            </div>
          )}

          {m.kind === 'restaurant' && (
            <OrderPanel mess={m} today={clock.date} tomorrow={tomorrow} nowMinutes={clock.minutes} />
          )}

          <MealReminders mess={m} otherName={remindersFor} />

          <section id="mess-report" aria-label="Tell us about a change" className="scroll-mt-24">
            {reporting ? (
              <div className="flex flex-col gap-3">
                <h2 className="m-0 text-[18px] font-bold text-ink">Something changed? Tell us</h2>
                <ReportForm mess={m} day={DAY_KEYS[dates.indexOf(date)] ?? 'mon'} />
              </div>
            ) : (
              <button
                type="button"
                onClick={openReport}
                className="text-[15px] font-semibold text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
              >
                Menu wrong or changed? Tell us
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
