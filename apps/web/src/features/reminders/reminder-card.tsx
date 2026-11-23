import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Bell, Lock } from '../../shared/ui/icons';
import type { LocalReminders } from './settings-store';
import { useReminders } from './use-reminders';

export const toggle = <T,>(list: T[], v: T) =>
  list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

export const Group = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <div role="group" aria-label={label} className="flex flex-col gap-2 min-w-0">
    <span className="text-[13px] font-semibold uppercase tracking-wide text-ink2">{label}</span>
    {hint && <span className="-mt-1 text-[13px] text-ink2">{hint}</span>}
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
);

/** A round on/off choice: a meal, a day, a subject. */
export function Chip({
  on,
  onClick,
  children,
  color,
  label,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  /** A subject's own colour, shown as a dot. */
  color?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex items-center gap-2 h-10 min-w-11 rounded-full px-3.5 text-[14px] font-semibold border-[1.5px] transition-colors ${on ? 'bg-ink text-bg border-ink' : 'border-line text-ink2 hover:text-ink hover:border-ink2'}`}
    >
      {color && (
        <span
          aria-hidden="true"
          className="w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-black/10"
          style={{ backgroundColor: color }}
        />
      )}
      {children}
    </button>
  );
}

/** One switch with its label: "Tomorrow's classes, the night before". */
export function Switch({
  on,
  onChange,
  children,
}: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-3 min-h-11 cursor-pointer text-[15px] text-ink">
      <input
        type="checkbox"
        role="switch"
        aria-checked={on}
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative w-11 h-6 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-teal ${on ? 'bg-teal' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`}
        />
      </span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

/** A small picture of the notification students will get. */
export function SampleNotification({ title, body }: { title: string; body: string }) {
  return (
    <div aria-hidden="true" className="flex gap-3 rounded-2xl bg-sunk p-3 max-w-[460px]">
      <img src="/apple-touch-icon.png" alt="" width={36} height={36} className="rounded-lg shrink-0" />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="flex justify-between gap-2 text-[13px]">
          <strong className="text-ink truncate">{title}</strong>
          <span className="text-ink2 shrink-0">now</span>
        </span>
        <span className="text-[13px] text-ink2 truncate">{body}</span>
      </span>
    </div>
  );
}

/**
 * Reminders, built into the tool they belong to. Off: a short ask with a picture of what arrives,
 * then the browser's own prompt only after "Turn on" (two steps; "Not now" hides it for a week).
 * On: the tool's own choices (`children`), saved as they're tapped, with a test and an off switch.
 */
export function ReminderCard({
  id,
  title,
  ask,
  sample,
  preset,
  children,
}: {
  id: string;
  title: string;
  /** One sentence: what arrives and when. */
  ask: string;
  sample: { title: string; body: string };
  /** What "Turn on" from here should already have chosen. */
  preset: (r: LocalReminders) => LocalReminders;
  /** The choices, shown once reminders are on for this device. */
  children: ReactNode;
}) {
  const r = useReminders();
  if (r.loading || r.state === 'hidden' || r.state === 'unsupported') return null;

  const frame = (body: ReactNode, on = false) => (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className={`print:hidden scroll-mt-24 border-t border-line pt-6 flex flex-col gap-4 ${on ? '' : 'max-w-[720px]'}`}
    >
      <header className="flex items-start gap-3">
        <span
          className={`shrink-0 grid place-items-center w-9 h-9 rounded-full ${on ? 'bg-teal text-white' : 'border-[1.5px] border-ink text-ink'}`}
        >
          <Bell size={20} />
        </span>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <h2
            id={`${id}-h`}
            className="m-0 font-display text-[22px] leading-tight font-bold tracking-[-0.02em] text-ink"
          >
            {title}
          </h2>
          <p className="m-0 text-[14px] leading-relaxed text-ink2">
            {on ? 'On for this device. Changes save as you tap.' : ask}
          </p>
        </div>
        {on && (
          <span role="status" className="shrink-0 text-[13px] font-semibold text-teal-text pt-1">
            {r.busy === 'save' ? 'Saving…' : r.saved ? 'Saved ✓' : ''}
          </span>
        )}
      </header>
      {body}
    </section>
  );

  if (r.state === 'on')
    return frame(
      <>
        {children}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={!!r.busy}
            onClick={async () => {
              await r.test();
            }}
          >
            {r.busy === 'test' ? 'Sending…' : 'Send a test'}
          </Button>
          <button
            type="button"
            disabled={!!r.busy}
            onClick={() => r.turnOff()}
            className="h-9 px-3 text-[14px] font-semibold text-blush-text underline underline-offset-4"
          >
            {r.busy === 'off' ? 'Turning off…' : 'Turn off on this device'}
          </button>
        </div>
        {r.error && (
          <p role="alert" className="m-0 text-[14px] text-blush-text">
            {r.error}
          </p>
        )}
        <OtherDevices />
        <p className="m-0 text-[12.5px] leading-relaxed text-ink2">
          Only this device's notification address and what you pick here are saved, never your whole
          timetable. Turning off stops meal and class reminders on this device.
        </p>
      </>,
      true,
    );

  // "Not now" was pressed: one quiet line instead of the card, so it's still easy to find.
  if (r.snoozed)
    return (
      <p id={id} className="print:hidden m-0 flex items-center gap-2 text-[14px] text-ink2">
        <Bell size={16} /> {title}: off.
        <button
          type="button"
          onClick={r.unsnooze}
          className="font-semibold text-ink underline underline-offset-4 decoration-line hover:decoration-ink"
        >
          Turn on
        </button>
      </p>
    );

  return frame(
    <>
      <SampleNotification {...sample} />
      {r.state === 'unconfigured' && (
        <p className="m-0 rounded-xl bg-marigold-soft px-4 py-3 text-[14px] text-marigold-text">
          <strong>Admin:</strong> the server has no push keys yet, so reminders can't be sent. Run{' '}
          <code>pnpm ops push:keys</code>, add them as Worker secrets, and deploy.
        </p>
      )}
      {r.state === 'ios-install' && <IphoneSteps />}
      {r.state === 'blocked' && <BlockedHelp />}
      <div className="flex flex-wrap gap-2">
        {r.state === 'ok' && (
          <Button variant="brand" disabled={!!r.busy} onClick={() => r.turnOn(preset)}>
            {r.busy === 'on' ? 'Turning on…' : 'Turn on'}
          </Button>
        )}
        <Button variant="ghost" onClick={r.snooze}>
          Not now
        </Button>
      </div>
      {r.error && (
        <p role="status" className="m-0 text-[14px] text-blush-text">
          {r.error}
        </p>
      )}
    </>,
  );
}

/** Signed in: every device getting reminders, each with "Remove". */
function OtherDevices() {
  const { me } = useSession();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['push-devices'], queryFn: api.pushDevices, enabled: !!me });
  if (!me || !devices.data?.length) return null;
  return (
    <details className="group">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink2 hover:text-ink">
        Devices getting reminders ({devices.data.length})
      </summary>
      <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-2">
        {devices.data.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-xl bg-sunk px-3 py-2">
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="text-[14px] font-semibold text-ink truncate">{d.label}</span>
              <span className="text-[13px] text-ink2 truncate">{d.summary}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await api.pushRemoveDevice(d.id).catch(() => {});
                void qc.invalidateQueries({ queryKey: ['push-devices'] });
              }}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </details>
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
