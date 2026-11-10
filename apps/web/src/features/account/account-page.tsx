import { type DeviceDto, contributorDisplayName } from '@ss/contracts';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Devices } from '../../shared/ui/icons';
import { Eyebrow, PageTitle } from '../../shared/ui/page-title';

function DeviceRow({
  d,
  onRemove,
  onCancelRemoval,
  busy,
  removalPending,
}: {
  d: DeviceDto;
  onRemove: () => void;
  onCancelRemoval: () => void;
  busy: boolean;
  removalPending: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-4 border-b border-line">
      <span className="w-11 h-11 rounded-full bg-sunk inline-flex items-center justify-center text-ink2">
        <Devices size={20} />
      </span>
      <span className="flex-1 min-w-[180px]">
        <span className="block font-semibold">
          {d.label}
          {d.current && (
            <span className="ml-2 font-mono text-[11px] px-2 py-0.5 rounded-md bg-mist text-on-mist">
              This device
            </span>
          )}
        </span>
        <span className="block text-sm text-ink2">Last seen {new Date(d.lastSeenAt).toLocaleString()}</span>
        {d.removalAt && (
          <span className="mt-1 block text-sm font-medium text-marigold-text">
            Stays signed in until{' '}
            {new Date(d.removalAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        )}
      </span>
      {!d.current && (
        <Button
          variant="outline"
          onClick={d.removalAt ? onCancelRemoval : onRemove}
          disabled={busy || (removalPending && !d.removalAt)}
        >
          {d.removalAt ? 'Keep device' : removalPending ? 'One removal pending' : 'Remove in 3 days'}
        </Button>
      )}
    </li>
  );
}

export function AccountPage() {
  const { me, setMe, signOut } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [now, setNow] = useState(Date.now());
  const [confirming, setConfirming] = useState<string | null>(null);

  const save = useMutation({ mutationFn: () => api.updateName(name.trim()), onSuccess: setMe });
  const emails = useMutation({ mutationFn: (on: boolean) => api.setEmailOptIn(on), onSuccess: setMe });
  const remove = useMutation({
    mutationFn: (id: string) => api.removeDevice(id),
    onSuccess: (m) => {
      setMe(m);
      setConfirming(null);
    },
  });
  const cancelRemoval = useMutation({
    mutationFn: (id: string) => api.cancelDeviceRemoval(id),
    onSuccess: setMe,
  });

  const fullName = me?.fullName;
  const email = me?.email;
  useEffect(() => {
    if (email) setName(fullName ?? contributorDisplayName(null, email));
  }, [fullName, email]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (me?.devices.some((d) => d.removalAt && new Date(d.removalAt).getTime() <= now)) {
      void api
        .me()
        .then(setMe)
        .catch(() => {});
    }
  }, [me, now, setMe]);

  if (!me) return null;
  const scheduledDevice = me.devices.find((d) => d.removalAt);
  const busy = remove.isPending || cancelRemoval.isPending;

  return (
    <Page>
      <div className="pt-4 flex flex-col gap-10 max-w-[720px]">
        <div>
          <Eyebrow>Borrower card</Eyebrow>
          <PageTitle>Account</PageTitle>
        </div>

        <section
          aria-labelledby="profile-h"
          className="rounded-[22px] bg-card border border-line p-6 flex flex-col gap-4"
        >
          <h2 id="profile-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Your name
          </h2>
          <p className="m-0 text-sm text-ink2">
            Your name appears beside notes you contribute to a course. Your reader watermark uses your college
            email.
          </p>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2) save.mutate();
            }}
          >
            <label htmlFor="full-name" className="sr-only">
              Full name
            </label>
            <input
              id="full-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="Your full name"
              className="flex-1 min-w-[200px] h-12 px-4 rounded-xl bg-surface border-[1.5px] border-line text-ink"
            />
            <Button
              type="submit"
              disabled={save.isPending || name.trim().length < 2 || name.trim() === me.fullName}
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </form>
          {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
          {save.isSuccess && <p className="m-0 text-sm text-teal-text">Saved.</p>}
          <div className="text-sm">
            <span className="text-ink2">{me.isAdmin ? 'Account email: ' : 'College email: '}</span>
            <span className="font-mono">{me.email}</span>
          </div>
        </section>

        <section
          aria-labelledby="email-h"
          className="rounded-[22px] bg-card border border-line p-6 flex flex-col gap-3"
        >
          <h2 id="email-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Emails
          </h2>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={me.emailOptIn}
              disabled={emails.isPending}
              onChange={(e) => emails.mutate(e.target.checked)}
              className="mt-1 w-5 h-5 accent-[var(--teal)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">Tell me about new courses and free tools</span>
              <span className="text-sm text-ink2">
                A few emails a semester at most. Sign-in codes are separate and always arrive.
              </span>
            </span>
          </label>
          {emails.isError && <p className="m-0 text-sm text-blush-text">{friendly(emails.error)}</p>}
        </section>

        <section aria-labelledby="devices-h">
          <h2 id="devices-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Devices <span className="font-mono text-sm text-ink2">{me.devices.length}/2</span>
          </h2>
          <p className="mt-2 mb-0 text-sm text-ink2 max-w-[560px]">
            Use up to two devices. A removal takes effect after three days, so the device stays usable during
            that time.
          </p>
          {scheduledDevice && (
            <p className="mt-2 mb-0 rounded-xl border border-marigold/60 bg-marigold-soft px-3 py-2 text-sm text-ink">
              <strong>{scheduledDevice.label}</strong> remains signed in until{' '}
              <strong>
                {new Date(scheduledDevice.removalAt!).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </strong>
              . A replacement device can sign in after that.
            </p>
          )}
          <ul className="list-none m-0 p-0 mt-2">
            {me.devices.map((d) =>
              confirming === d.id ? (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-4 border-b border-line">
                  <span className="flex-1 text-sm">
                    Schedule <strong>{d.label}</strong> to sign out in three days? It keeps working until
                    then. You can cancel before it signs out.
                  </span>
                  <Button variant="ink" onClick={() => remove.mutate(d.id)} disabled={busy}>
                    {remove.isPending ? 'Removing…' : 'Yes, remove'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>
                    Cancel
                  </Button>
                </li>
              ) : (
                <DeviceRow
                  key={d.id}
                  d={d}
                  busy={busy}
                  removalPending={Boolean(scheduledDevice)}
                  onRemove={() => setConfirming(d.id)}
                  onCancelRemoval={() => cancelRemoval.mutate(d.id)}
                />
              ),
            )}
          </ul>
          {remove.isError && <p className="text-sm text-blush-text">{friendly(remove.error)}</p>}
          {cancelRemoval.isError && (
            <p className="text-sm text-blush-text">{friendly(cancelRemoval.error)}</p>
          )}
        </section>

        <div>
          <Button
            variant="outline"
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </Page>
  );
}
