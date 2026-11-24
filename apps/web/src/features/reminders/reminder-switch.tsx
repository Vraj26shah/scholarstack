import { Bell } from '../../shared/ui/icons';
import type { LocalReminders } from './settings-store';
import { useReminders } from './use-reminders';

/**
 * One switch at the top of a tool: meal reminders on the Mess menu, class reminders in the
 * Timetable maker. Turning it off stops only that kind; the device is let go only when nothing is
 * left. The detailed choices stay in the card further down ("Settings" jumps there).
 */
export function ReminderSwitch({
  label,
  isOn,
  enable,
  disable,
  settings,
}: {
  label: string;
  /** Is this kind of reminder on for this device? */
  isOn: (r: LocalReminders) => boolean;
  /** The settings to turn it on with (or to add to reminders already on). */
  enable: (r: LocalReminders) => LocalReminders;
  disable: (r: LocalReminders) => LocalReminders;
  /** The id of the full settings card on this page. */
  settings: string;
}) {
  const r = useReminders();
  if (r.state === 'hidden' || r.state === 'unconfigured' || r.state === 'unsupported') return null;
  const on = r.state === 'on' && isOn(r.local);
  const blocked = r.state === 'blocked' || r.state === 'ios-install';
  const busy = !!r.busy;

  const flip = () => {
    if (blocked) {
      document.getElementById(settings)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (!on) {
      if (r.state === 'on') r.update(enable);
      else void r.turnOn(enable);
      return;
    }
    r.stopKind(disable);
  };

  return (
    <div className="inline-flex items-center gap-3 rounded-full border-[1.5px] border-line bg-surface pl-3 pr-1.5 h-11">
      <Bell size={17} />
      <span className="text-[14px] font-semibold text-ink whitespace-nowrap">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}: ${on ? 'on' : 'off'}`}
        disabled={busy}
        onClick={flip}
        title={blocked ? 'Notifications are blocked: see how to allow them' : undefined}
        className={`relative w-12 h-7 shrink-0 rounded-full border-0 cursor-pointer transition-colors disabled:opacity-60 ${on ? 'bg-teal' : 'bg-line'}`}
      >
        <span
          className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-6' : 'left-1'}`}
        />
      </button>
      <a
        href={`#${settings}`}
        onClick={(e) => {
          e.preventDefault();
          document.getElementById(settings)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className="hidden sm:inline text-[13px] font-semibold text-ink2 underline underline-offset-2 hover:text-ink pr-2"
      >
        {blocked ? 'Why off?' : 'Settings'}
      </a>
    </div>
  );
}
