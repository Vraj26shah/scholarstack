import { Skeleton } from '../../../shared/ui/feedback';
import { ReminderPrompt } from '../../reminders/reminder-prompt';
import { ReminderSettings } from '../../reminders/reminder-settings';
import { useReminders } from '../../reminders/use-reminders';
import { ToolHeader } from '../core/ui';

const EXAMPLES = [
  {
    title: 'Lunch in 30 min 🍛',
    body: 'Rajma masala, jeera aloo, curd, salad · Safal hostel mess',
    at: '11:45 am',
  },
  { title: 'Tomorrow · 3 classes', body: 'DSA 8:30 · Java 10:05 · OS 2:00', at: '9:00 pm' },
  {
    title: 'Dinner in 30 min · paneer ⭐',
    body: 'Palak paneer, mix vegetable salad, rasam, curd rice',
    at: '7:00 pm',
  },
];

/** Toolbox › Reminders: what they look like, then the settings for this device. */
export default function RemindersTool() {
  const r = useReminders();
  return (
    <div className="flex flex-col gap-8">
      <ToolHeader
        title="Reminders"
        lead="Your mess menu before each meal and tomorrow's classes the night before, on your phone or laptop, even when the site is closed."
        footnote="Only a notification address and what you pick here are saved."
      />

      <section aria-labelledby="looks-h" className="flex flex-col gap-3 max-w-[640px]">
        <h2 id="looks-h" className="m-0 text-[18px] font-bold text-ink">
          What they look like
        </h2>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {EXAMPLES.map((e) => (
            <li key={e.title} className="flex gap-3 rounded-2xl bg-sunk p-3">
              <img
                src="/apple-touch-icon.png"
                alt=""
                width={36}
                height={36}
                className="rounded-lg shrink-0"
              />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="flex justify-between gap-2 text-[14px]">
                  <strong className="text-ink truncate">{e.title}</strong>
                  <span className="text-ink2 shrink-0">{e.at}</span>
                </span>
                <span className="text-[14px] text-ink2 truncate">{e.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="m-0 text-[14px] leading-relaxed text-ink2">
          A new one replaces the last of the same kind, so they never pile up. Nothing for a meal whose menu
          isn't in, no class list for a day off, and "Mute today" means nothing more until tomorrow. Never
          ads.
        </p>
      </section>

      {r.loading ? (
        <Skeleton className="h-40 max-w-[640px]" />
      ) : r.state === 'on' ? (
        <section aria-labelledby="mine-h" className="flex flex-col gap-3 max-w-[640px]">
          <h2 id="mine-h" className="m-0 text-[18px] font-bold text-ink">
            On this device
          </h2>
          <ReminderSettings />
        </section>
      ) : r.state === 'hidden' ? (
        <p className="m-0 text-[15px] text-ink2">Reminders aren't open yet.</p>
      ) : r.state === 'unsupported' ? (
        <p className="m-0 max-w-[640px] text-[15px] text-ink2">
          This browser can't show notifications from websites. Try Chrome, Edge or Firefox on your phone or
          computer, or the home-screen app on iPhone.
        </p>
      ) : (
        <ReminderPrompt context={{ kind: 'page' }} />
      )}
    </div>
  );
}
