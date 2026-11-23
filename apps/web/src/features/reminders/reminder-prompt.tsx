import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import { Bell, Lock } from '../../shared/ui/icons';
import { ReminderSettings } from './reminder-settings';
import type { LocalReminders } from './settings-store';
import { useReminders } from './use-reminders';

type Context =
  | { kind: 'mess'; slug: string; name: string }
  | { kind: 'timetable' }
  /** Toolbox › Reminders: the card is the page's main action, never snoozed away. */
  | { kind: 'page' };

const COPY: Record<Context['kind'], { title: string; body: (c: Context) => string }> = {
  mess: {
    title: 'Get the menu before you go',
    body: (c) =>
      `Lunch & dinner at ${c.kind === 'mess' ? c.name : 'your mess'}, 30 min before, on this device. Even when the site is closed.`,
  },
  timetable: {
    title: "Tomorrow's classes, every night",
    body: () =>
      'A short list at 9 pm, and a nudge before class if you want one. Only for the subjects you pick.',
  },
  page: {
    title: 'Turn on reminders',
    body: () =>
      'Meals 30 min before they start and tomorrow’s classes at 9 pm. You choose which, and you can stop any time.',
  },
};

/** What turning on from here should already have ticked. */
const preset =
  (c: Context) =>
  (r: LocalReminders): LocalReminders =>
    c.kind === 'mess'
      ? { ...r, mess: { ...r.mess, slug: c.slug } }
      : c.kind === 'timetable'
        ? { ...r, classes: { ...r.classes, nightly: true } }
        : r;

/**
 * Offers reminders right after a useful moment, in two steps: this card first, the browser's own
 * "Allow notifications?" only after "Turn on". "Not now" hides it for a week, so nobody is ever
 * shown a browser prompt they didn't ask for. Once on, it shrinks to one line with "Change".
 */
export function ReminderPrompt({ context }: { context: Context }) {
  const r = useReminders();
  const [settings, setSettings] = useState(false);
  const copy = COPY[context.kind];
  const page = context.kind === 'page';

  if (r.loading || r.state === 'hidden' || r.state === 'unsupported') return null;
  if (r.snoozed && !page && r.state !== 'on') return null;

  const sheet = (
    <Sheet open={settings} onOpenChange={setSettings} title="Your reminders" closeButton>
      <ReminderSettings onDone={() => setSettings(false)} />
    </Sheet>
  );

  if (r.state === 'on')
    return (
      <div className="print:hidden flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink2">
        <span className="inline-flex items-center gap-2 font-semibold text-teal-text">
          <Bell size={16} /> Reminders are on for this device
        </span>
        <button
          type="button"
          onClick={() => setSettings(true)}
          className="font-semibold text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
        >
          Change
        </button>
        {sheet}
      </div>
    );

  return (
    <section
      aria-label="Reminders"
      className="print:hidden max-w-[640px] rounded-[18px] bg-card p-5 shadow-[0_18px_34px_-26px_var(--shadow),0_0_0_1px_var(--line)] flex flex-col gap-3"
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 grid place-items-center w-10 h-10 rounded-full bg-mist text-on-mist">
          <Bell size={20} />
        </span>
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="m-0 text-[18px] font-bold text-ink">{copy.title}</h2>
          <p className="m-0 text-[15px] leading-relaxed text-ink2">{copy.body(context)}</p>
        </div>
      </div>

      {r.state === 'unconfigured' && (
        <p className="m-0 rounded-xl bg-marigold-soft px-4 py-3 text-[14px] text-marigold-text">
          <strong>Admin:</strong> the server has no push keys yet, so reminders can't be sent. Run{' '}
          <code>pnpm ops push:keys</code>, add them as Worker secrets, and deploy.
        </p>
      )}

      {r.state === 'ios-install' && <IphoneSteps />}
      {r.state === 'blocked' && <BlockedHelp />}

      {r.state === 'ok' && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="brand"
            disabled={!!r.busy}
            onClick={async () => {
              if (await r.turnOn(preset(context))) setSettings(true);
            }}
          >
            {r.busy === 'on' ? 'Turning on…' : 'Turn on'}
          </Button>
          {!page && (
            <Button variant="ghost" onClick={r.snooze}>
              Not now
            </Button>
          )}
        </div>
      )}
      {(r.state === 'ios-install' || r.state === 'blocked') && !page && (
        <Button variant="ghost" className="self-start" onClick={r.snooze}>
          Not now
        </Button>
      )}
      {r.error && (
        <p role="status" className="m-0 text-[14px] text-blush-text">
          {r.error}
        </p>
      )}
      {!page && (
        <Link to="/tools/reminders" className="self-start text-[13px] font-semibold text-ink2 hover:text-ink">
          How reminders work
        </Link>
      )}
      {sheet}
    </section>
  );
}

const ShareIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path
      d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const AddIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8v8M8 12h8" strokeLinecap="round" />
  </svg>
);

/** iPhone: notifications only reach the home-screen app (Safari's rule, iOS 16.4 and later). */
function IphoneSteps() {
  const steps = [
    { icon: <ShareIcon />, text: 'Tap Share at the bottom of Safari' },
    { icon: <AddIcon />, text: 'Choose Add to Home Screen, then Add' },
    {
      icon: <img src="/apple-touch-icon.png" alt="" width={18} height={18} className="rounded" />,
      text: 'Open Scholars Stack from your home screen and turn reminders on there',
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-[14px] text-ink2">
        On iPhone, reminders work from the home-screen version of the site:
      </p>
      <ol className="m-0 p-0 list-none grid gap-2 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.text}
            className="flex sm:flex-col items-center sm:items-start gap-3 rounded-xl bg-sunk p-3"
          >
            <span className="shrink-0 grid place-items-center w-9 h-9 rounded-full bg-surface text-ink shadow-[0_0_0_1px_var(--line)]">
              {s.icon}
            </span>
            <span className="text-[14px] text-ink">
              <strong>{i + 1}.</strong> {s.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Blocked: no broken button, just where the setting is, with a small picture of it. */
function BlockedHelp() {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[14px] text-ink">
        Notifications are blocked for this site. Allow them in your browser's site settings → Notifications,
        then reload this page.
      </p>
      <div
        aria-hidden="true"
        className="max-w-[360px] rounded-xl bg-sunk p-3 flex flex-col gap-2 text-[13px]"
      >
        <div className="flex items-center gap-2 rounded-full bg-surface px-3 h-9 shadow-[0_0_0_1px_var(--line)]">
          <span className="grid place-items-center w-6 h-6 rounded-full bg-mist text-on-mist ring-2 ring-teal">
            <Lock size={13} />
          </span>
          <span className="text-ink2 truncate">
            {typeof window !== 'undefined' ? window.location.host : 'scholarsstack'}
          </span>
        </div>
        <div className="ml-4 rounded-xl bg-surface p-3 shadow-[0_0_0_1px_var(--line)] flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-ink">
            <Bell size={14} /> Notifications
          </span>
          <span className="rounded-md bg-mist px-2 py-0.5 font-semibold text-on-mist">Allow</span>
        </div>
        <span className="text-ink2">Tap the icon left of the address, then set Notifications to Allow.</span>
      </div>
    </div>
  );
}
