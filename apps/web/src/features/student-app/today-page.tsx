import {
  MEAL_NAMES,
  type MessDto,
  type MessOrderDto,
  OPEN_MESS_ORDER,
  campusClock,
  dishesOn,
  formatClock,
  toMinutes,
} from '@ss/contracts';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { isNativeApp } from '../../lib/app-mode';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { Bowl, Calculator, Calendar, Check, ShelfIcon, Upload } from '../../shared/ui/icons';
import { verdict } from '../tools/attendance/components/plan-subject-row';
import { type SubjectPlan, campusToday, planFor, readState, upcomingExam } from '../tools/attendance/planner';
import { useToolState } from '../tools/core/storage';
import { mealState } from '../tools/mess/components/mess-grid';
import { type ClassSlot, type Course, dayClasses, clock as fmt } from '../tools/timetable/domain';
import { AppScreen, MoreLink, SectionLabel, TodayCard, card } from './app-ui';

// ── Data (read field by field: old saved copies may differ) ──

function useCourses(): Course[] {
  const [raw] = useToolState<unknown>('timetable_courses', []);
  return useMemo(
    () =>
      (Array.isArray(raw) ? raw : []).flatMap((c) => {
        if (!c || typeof c !== 'object') return [];
        const o = c as Partial<Course>;
        if (typeof o.id !== 'string' || !Array.isArray(o.slots)) return [];
        return [
          {
            id: o.id,
            name: typeof o.name === 'string' ? o.name : '',
            code: typeof o.code === 'string' ? o.code : '',
            teacher: typeof o.teacher === 'string' ? o.teacher : '',
            slots: o.slots.filter((s): s is string => typeof s === 'string'),
            color: typeof o.color === 'string' ? o.color : '#A1D6E2',
            tentative: o.tentative === true,
            ...(typeof o.room === 'string' ? { room: o.room } : {}),
          },
        ];
      }),
    [raw],
  );
}

function useCampusClock() {
  const [now, setNow] = useState(() => campusClock(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setNow(campusClock(new Date())), 30_000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

/** Today's classes, or the next teaching day's if today is done or a Sunday. */
function classDay(courses: Course[], day: number, minutes: number) {
  const registered = courses.filter((c) => !c.tentative);
  if (!registered.length) return null;
  const today = day < 6 ? dayClasses(registered, day) : [];
  if (today.some((c) => c.end > minutes)) return { label: 'Today', list: today, isToday: true };
  for (let ahead = 1; ahead <= 7; ahead++) {
    const d = (day + ahead) % 7;
    if (d === 6) continue;
    const list = dayClasses(registered, d);
    if (list.length)
      return {
        label:
          ahead === 1 ? 'Tomorrow' : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]!,
        list,
        isToday: false,
      };
  }
  return null;
}

// ── Screen ──

/** /app: the student app's home. One look: your order, your classes, today's food, attendance. */
export default function TodayPage() {
  const { me, status } = useSession();
  const now = useCampusClock();
  const courses = useCourses();
  const hour = Math.floor(now.minutes / 60);
  const greeting =
    hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const first = me?.fullName?.split(' ')[0] || me?.email.split('@')[0]?.split(/[._\d]/)[0] || '';
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';

  const classes = useMemo(() => classDay(courses, now.day, now.minutes), [courses, now.day, now.minutes]);

  const [choice] = useToolState<unknown>('mess_choice', null);
  const slug = typeof choice === 'string' ? choice : null;
  const mess = useQuery({
    queryKey: ['mess', slug],
    queryFn: () => api.mess(slug!),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  });

  const [plannerRaw] = useToolState<unknown>('attendance_planner', null);
  const [legacy] = useToolState<unknown>('attendance_subjects', null);
  const attendance = useMemo(() => {
    const state = readState(plannerRaw, legacy);
    const today = campusToday();
    const exam = upcomingExam(state.exams, today);
    if (!exam || !state.subjects.length) return null;
    const plans = planFor(state, exam, today).filter((p) => p.status !== 'empty' && p.status !== 'invalid');
    if (!plans.length) return null;
    const rank = { risk: 0, recover: 1, safe: 2, empty: 3, invalid: 3 };
    const sorted = [...plans].sort(
      (a, b) => rank[a.status] - rank[b.status] || (a.canSkip ?? -1) - (b.canSkip ?? -1),
    );
    const days = exam.date ? Math.ceil((Date.parse(exam.date) - Date.parse(today)) / 86_400_000) : null;
    return { exam, sorted, days, safe: plans.filter((p) => p.status === 'safe').length };
  }, [plannerRaw, legacy]);

  const orders = useQuery({
    queryKey: ['my-mess-orders'],
    queryFn: api.myMessOrders,
    enabled: status === 'ready',
    refetchInterval: 15_000,
  });
  const active = (orders.data ?? []).filter((o) => OPEN_MESS_ORDER.includes(o.status));

  // The glance strip: next class, next meal, exam countdown.
  const nextClass = (() => {
    if (!classes) return null;
    const m = classes.isToday ? now.minutes : -1;
    const c = classes.list.find((x) => x.end > m);
    return c ? { c, live: c.start <= m } : null;
  })();
  const nextMeal = (() => {
    const d = mess.data;
    if (!d) return null;
    const states = d.meals.map((x) => mealState(x, now.minutes));
    const i = states.indexOf('now') >= 0 ? states.indexOf('now') : states.indexOf('later');
    const meal = i >= 0 ? d.meals[i] : null;
    if (!meal) return null;
    const isNow = states[i] === 'now';
    return {
      now: isNow,
      name: MEAL_NAMES[meal.key],
      when: isNow ? `till ${formatClock(toMinutes(meal.end))}` : formatClock(toMinutes(meal.start)),
    };
  })();

  // One plain sentence under the greeting.
  const left = classes?.isToday ? classes.list.filter((c) => c.end > now.minutes).length : 0;
  const summary = [
    classes?.isToday
      ? left
        ? `${left} class${left === 1 ? '' : 'es'} left today`
        : 'No more classes today'
      : classes
        ? 'No classes left today'
        : '',
    attendance?.days != null && attendance.days > 0
      ? `${attendance.exam.name} in ${attendance.days} day${attendance.days === 1 ? '' : 's'}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Page>
      <AppScreen>
        <TodayCard>
          <h1 className="m-0 font-display font-extrabold text-[26px] leading-[1.08] tracking-[-0.035em]">
            {greeting}
            {name ? `, ${name}` : ''}.
          </h1>
          {summary && <p className="m-0 text-[14px] text-on-brand2">{summary}</p>}
          <div className="mt-3" />
          <Glance
            items={[
              nextClass
                ? {
                    label: nextClass.live ? 'In class now' : 'Next class',
                    value: fmt(nextClass.c.start).replace(/ (am|pm)$/, ''),
                    detail: `${fmt(nextClass.c.start).slice(-2)} · ${nextClass.c.course.code || nextClass.c.course.name}`,
                    to: '/tools/timetable',
                  }
                : { label: 'Classes', value: '—', detail: 'Add timetable', to: '/tools/timetable' },
              nextMeal
                ? {
                    label: nextMeal.now ? 'Serving now' : 'Next meal',
                    value: nextMeal.name,
                    detail: nextMeal.when,
                    to: '/tools/mess-menu',
                  }
                : {
                    label: 'Food',
                    value: '—',
                    detail: slug ? 'Done today' : 'Choose mess',
                    to: '/tools/mess-menu',
                  },
              attendance?.days != null && attendance.days > 0
                ? {
                    label: attendance.exam.name,
                    value: `${attendance.days}d`,
                    detail: `${attendance.safe}/${attendance.sorted.length} on track`,
                    to: '/tools/attendance',
                  }
                : { label: 'Attendance', value: '—', detail: 'Set up', to: '/tools/attendance' },
            ]}
          />
        </TodayCard>

        <GetAppNudge />

        {active.map((o) => (
          <OrderTracker key={o.id} order={o} />
        ))}

        <section className="flex flex-col gap-3">
          <SectionLabel action={<MoreLink to="/tools/timetable">Timetable</MoreLink>}>
            {classes ? `Classes · ${classes.label}` : 'Classes'}
          </SectionLabel>
          {classes ? (
            <ClassList list={classes.list} minutes={classes.isToday ? now.minutes : -1} />
          ) : (
            <Empty
              icon={<Calendar size={22} />}
              title="Make your timetable"
              text="Pick your slots once. Your classes show up here, with a reminder before each one."
              to="/tools/timetable"
              cta="Make timetable"
            />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel action={<MoreLink to="/tools/mess-menu">{slug ? 'Full menu' : 'Choose'}</MoreLink>}>
            Food
          </SectionLabel>
          {mess.data ? (
            <FoodCard mess={mess.data} date={now.date} minutes={now.minutes} />
          ) : slug && mess.isLoading ? (
            <div className={`${card} h-[132px] animate-pulse`} />
          ) : (
            <Empty
              icon={<Bowl size={22} />}
              title="What’s cooking?"
              text="Choose your hostel mess or a restaurant near campus to see today’s menu and order."
              to="/tools/mess-menu"
              cta="Choose mess"
            />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel action={<MoreLink to="/tools/attendance">Planner</MoreLink>}>
            {attendance ? `Attendance · ${attendance.exam.name}` : 'Attendance'}
          </SectionLabel>
          {attendance ? (
            <AttendanceCard
              plans={attendance.sorted}
              exam={attendance.exam}
              safe={attendance.safe}
              days={attendance.days}
            />
          ) : (
            <Empty
              icon={<Check size={22} />}
              title="Can you skip a class?"
              text="Add your CAT and Term End dates once. See how many classes you can skip, subject by subject."
              to="/tools/attendance"
              cta="Set up"
            />
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionLabel>Shortcuts</SectionLabel>
          <div className="grid grid-cols-4 gap-2">
            {[
              {
                to: '/shelf',
                label: 'My notes',
                icon: <ShelfIcon size={22} />,
              },
              {
                to: '/tools/cgpa',
                label: 'CGPA',
                icon: <Calculator size={22} />,
              },
              {
                to: '/my-orders',
                label: 'Orders',
                icon: <Bowl size={22} />,
              },
              { to: '/contribute', label: 'Earn', icon: <Upload size={22} /> },
            ].map((x) => (
              <Link
                key={x.to}
                to={x.to}
                className="flex flex-col items-center gap-1.5 py-1 no-underline text-ink press"
              >
                <span className={`${card} grid place-items-center size-14 text-brand dark:text-mist`}>
                  {x.icon}
                </span>
                <span className="text-[12.5px] font-semibold">{x.label}</span>
              </Link>
            ))}
          </div>
        </section>
      </AppScreen>
    </Page>
  );
}

// ── Cards ──

function Empty({
  icon,
  title,
  text,
  to,
  cta,
}: { icon: ReactNode; title: string; text: string; to: string; cta: string }) {
  return (
    <div className={`${card} p-5 flex gap-4 items-start`}>
      <span className="grid place-items-center size-11 flex-none rounded-full bg-brand/[0.07] text-brand dark:bg-white/10 dark:text-mist">
        {icon}
      </span>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div>
          <p className="m-0 text-[16px] font-extrabold">{title}</p>
          <p className="m-0 text-[14px] leading-snug text-ink2">{text}</p>
        </div>
        <Link
          to={to}
          className="self-start inline-flex items-center h-9 px-4 rounded-full bg-ink text-bg text-[14px] font-bold no-underline press"
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}

const STEPS: { key: MessOrderDto['status']; label: string }[] = [
  { key: 'placed', label: 'Sent' },
  { key: 'accepted', label: 'Being made' },
  { key: 'ready', label: 'Ready' },
];

function OrderTracker({ order: o }: { order: MessOrderDto }) {
  const at = STEPS.findIndex((s) => s.key === o.status);
  return (
    <Link
      to="/my-orders"
      className="rounded-[20px] bg-brand text-white p-5 flex flex-col gap-4 no-underline press"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-mono text-[12px] text-on-brand2 truncate">
            {o.messName} · #{o.code}
          </p>
          <p className="m-0 text-[19px] font-extrabold leading-tight">
            {o.status === 'placed'
              ? 'Waiting for the restaurant'
              : o.status === 'accepted'
                ? 'Your food is being made'
                : 'Ready to collect'}
          </p>
        </div>
        {o.unread > 0 && (
          <span className="flex-none rounded-full bg-white text-brand px-2.5 py-1 text-[12px] font-bold">
            {o.unread} new
          </span>
        )}
      </div>
      <ol className="m-0 p-0 list-none grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-col gap-1.5">
            <span className={`h-1.5 rounded-full ${i <= at ? 'bg-mist' : 'bg-white/20'}`} />
            <span className={`text-[12px] ${i <= at ? 'font-bold text-white' : 'text-on-brand2'}`}>
              {s.label}
            </span>
          </li>
        ))}
      </ol>
    </Link>
  );
}

function ClassList({ list, minutes }: { list: ClassSlot[]; minutes: number }) {
  return (
    <ol className={`${card} m-0 p-2 list-none flex flex-col`}>
      {list.map((c) => {
        const live = c.start <= minutes && minutes < c.end;
        const done = minutes >= c.end;
        return (
          <li
            key={c.slot}
            className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 ${live ? 'bg-mist/35' : ''} ${done ? 'opacity-45' : ''}`}
          >
            <span className="w-[62px] flex-none font-mono text-[12.5px] leading-tight text-ink2 tabular-nums">
              {fmt(c.start)}
            </span>
            <span
              className="w-1 self-stretch flex-none rounded-full"
              style={{ backgroundColor: c.course.color }}
            />
            <span className="flex-1 min-w-0">
              <span className="block text-[15.5px] font-bold leading-tight truncate">
                {c.course.name || c.course.code}
              </span>
              <span className="block text-[12.5px] text-ink2 truncate">
                {[c.course.code, c.course.room, `slot ${c.slot}`].filter(Boolean).join(' · ')}
              </span>
            </span>
            {live && (
              <span className="flex-none rounded-full bg-teal px-2 py-0.5 text-[11px] font-bold text-white">
                Now
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function FoodCard({ mess, date, minutes }: { mess: MessDto; date: string; minutes: number }) {
  const states = mess.meals.map((m) => mealState(m, minutes));
  const i = states.indexOf('now') >= 0 ? states.indexOf('now') : states.indexOf('later');
  const meal = i >= 0 ? mess.meals[i] : null;
  const dishes = meal ? dishesOn(mess, date, meal.key).map((d) => d.name) : [];
  const orderable = mess.kind === 'restaurant' && mess.ordersOpen;
  return (
    <div className={`${card} p-5 flex flex-col gap-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold text-ink2 truncate">{mess.name}</p>
          <p className="m-0 text-[19px] font-extrabold leading-tight">
            {meal ? MEAL_NAMES[meal.key] : 'Done for today'}
          </p>
        </div>
        {meal && (
          <span
            className={`flex-none rounded-full px-2.5 py-1 text-[12px] font-bold ${states[i] === 'now' ? 'bg-[#e3f4ea] text-[#14532d] dark:bg-[#123222] dark:text-[#b8f0cc]' : 'bg-sunk text-ink2'}`}
          >
            {states[i] === 'now'
              ? `Till ${formatClock(toMinutes(meal.end))}`
              : `From ${formatClock(toMinutes(meal.start))}`}
          </span>
        )}
      </div>
      {dishes.length > 0 ? (
        <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5">
          {dishes.slice(0, 8).map((d) => (
            <li key={d} className="rounded-full bg-sunk px-3 py-1 text-[13.5px] font-medium">
              {d}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[14px] text-ink2">
          {meal
            ? 'Menu not in yet.'
            : mess.kind === 'restaurant'
              ? 'See the full menu to order.'
              : 'Tomorrow’s menu is on the full menu.'}
        </p>
      )}
      {orderable && (
        <Link
          to="/tools/mess-menu"
          className="self-start inline-flex items-center gap-2 h-10 px-5 rounded-full bg-marigold text-on-marigold text-[14px] font-bold no-underline press"
        >
          <Bowl size={16} /> Order food
        </Link>
      )}
    </div>
  );
}

function AttendanceCard({
  plans,
  exam,
  safe,
  days,
}: { plans: SubjectPlan[]; exam: Parameters<typeof verdict>[1]; safe: number; days: number | null }) {
  const tone = (p: SubjectPlan) =>
    p.status === 'safe'
      ? 'bg-mist text-on-mist'
      : p.status === 'recover'
        ? 'bg-marigold-soft text-marigold-text'
        : 'bg-blush text-blush-text';
  return (
    <div className={`${card} p-2 flex flex-col`}>
      <div className="flex items-center gap-3 px-3 pt-2 pb-3 border-b border-line/70">
        <span className="font-display font-extrabold text-[30px] leading-none tabular-nums">
          {safe}/{plans.length}
        </span>
        <span className="text-[14px] leading-snug text-ink2">
          subjects on track for {exam.name}
          {days != null && days > 0 ? ` · ${days} day${days === 1 ? '' : 's'} to go` : ''}
        </span>
      </div>
      <ul className="m-0 p-0 list-none">
        {plans.slice(0, 4).map((p) => (
          <li
            key={p.subject.id}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-line/50 last:border-b-0"
          >
            <span
              className={`w-12 flex-none rounded-lg py-1 text-center font-mono text-[13px] font-bold ${tone(p)}`}
            >
              {p.now === null ? '––' : `${p.now}%`}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-bold truncate">{p.subject.name}</span>
              <span className="block text-[12.5px] leading-snug text-ink2 line-clamp-2">
                {verdict(p, exam)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Glance({ items }: { items: { label: string; value: string; detail: string; to: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((x) => (
        <Link
          key={x.label}
          to={x.to}
          className="rounded-2xl bg-white/[0.08] ring-1 ring-white/10 px-3 py-2.5 flex flex-col gap-0.5 no-underline text-white active:bg-white/15 min-w-0"
        >
          <span className="text-[11.5px] font-medium text-on-brand2 truncate">{x.label}</span>
          <span className="font-display font-bold text-[20px] leading-tight tracking-[-0.02em] truncate">
            {x.value}
          </span>
          <span className="text-[12px] text-mist truncate">{x.detail}</span>
        </Link>
      ))}
    </div>
  );
}

/** On a phone's browser (not in the app): one quiet line pointing to the Android app, until closed. */
function GetAppNudge() {
  const [hidden, setHidden] = useState(() => {
    try {
      return (
        isNativeApp() ||
        !/Android/i.test(navigator.userAgent) ||
        localStorage.getItem('ss_getapp_hidden') === '1'
      );
    } catch {
      return true;
    }
  });
  if (hidden) return null;
  return (
    <div className="flex items-center gap-3 -mt-3 px-1">
      <Link to="/get-app" className="flex-1 min-w-0 text-[14px] font-semibold text-teal-text no-underline">
        Get the Android app: reminders that ring even when it's closed →
      </Link>
      <button
        type="button"
        aria-label="Hide"
        onClick={() => {
          try {
            localStorage.setItem('ss_getapp_hidden', '1');
          } catch {
            // storage blocked: hidden for now
          }
          setHidden(true);
        }}
        className="grid place-items-center size-8 flex-none rounded-full text-ink2 bg-transparent border-0 cursor-pointer"
      >
        ×
      </button>
    </div>
  );
}
