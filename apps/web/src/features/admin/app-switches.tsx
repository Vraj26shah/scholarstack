import type { FeatureDto, FeatureStatus } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, friendly } from '../../lib/api';
import { forgetFeatureSwitches } from '../../lib/food-live';
import { Skeleton } from '../../shared/ui/feedback';

const CHOICES: { status: FeatureStatus; label: string; hint: string }[] = [
  { status: 'live', label: 'Live', hint: 'Everyone sees and uses it' },
  { status: 'soon', label: 'Coming soon', hint: 'Shown as coming soon; hidden from Today, tabs and buttons' },
  { status: 'hidden', label: 'Hidden', hint: 'Not shown anywhere' },
];

/** What each feature covers in the app, so the switch says what it changes. */
const COVERS: Record<string, string> = {
  'mess-menu': 'Food tab, menus, Order food, My orders, order trackers',
  timetable: 'Classes on Today, class reminders',
  attendance: 'Attendance on Today, exam countdown',
  cgpa: 'CGPA shortcut',
};

function SwitchRow({ f }: { f: FeatureDto }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (status: FeatureStatus) =>
      api.adminSaveFeature(f.key, { title: f.title, blurb: f.blurb, status }),
    onSuccess: () => {
      forgetFeatureSwitches();
      void qc.invalidateQueries({ queryKey: ['admin-features'] });
      void qc.invalidateQueries({ queryKey: ['features'] });
    },
  });
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
      <div className="min-w-[200px] flex-1">
        <p className="m-0 text-[15px] font-bold text-ink">{f.title}</p>
        <p className="m-0 text-[13px] text-ink2">{COVERS[f.key] ?? f.blurb}</p>
        {save.error && (
          <p role="alert" className="m-0 mt-1 text-[13px] text-blush-text">
            {friendly(save.error)}
          </p>
        )}
      </div>
      <fieldset
        className="m-0 p-1 border-0 inline-flex rounded-full bg-sunk ring-1 ring-line"
        aria-label={`${f.title}: who sees it`}
        disabled={save.isPending}
      >
        {CHOICES.map((c) => {
          const on = f.status === c.status;
          return (
            <button
              key={c.status}
              type="button"
              title={c.hint}
              aria-pressed={on}
              onClick={() => !on && save.mutate(c.status)}
              className={`h-8 px-3.5 rounded-full border-0 text-[13px] font-semibold cursor-pointer ${
                on
                  ? c.status === 'live'
                    ? 'bg-teal text-white'
                    : 'bg-ink text-bg'
                  : 'bg-transparent text-ink2 hover:text-ink'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </fieldset>
    </li>
  );
}

/**
 * Admin › Apps: one switch per feature for the website and the Android apps together. The apps
 * load the live website, so a change here reaches every phone with the app within a minute,
 * with no app update. Launching with an email to students stays in Mail.
 */
export function AppSwitches() {
  const q = useQuery({ queryKey: ['admin-features'], queryFn: api.adminFeatures });
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-[15px] font-bold">What students see (website and app)</h3>
      <p className="m-0 text-[13.5px] text-ink2">
        The Android app shows the live website, so these switches change both at once, within a minute, with
        no app update. You always see everything, to set it up. To launch with an email to students, use
        Launch in Mail.
      </p>
      {!q.data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <ul className="m-0 p-0 list-none divide-y divide-line">
          {q.data.map((f) => (
            <SwitchRow key={f.key} f={f} />
          ))}
        </ul>
      )}
    </section>
  );
}
