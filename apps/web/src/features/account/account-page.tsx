import type { DeviceDto } from '@ss/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Devices } from '../../shared/ui/icons';

function DeviceRow({ d, onRemove, busy }: { d: DeviceDto; onRemove: () => void; busy: boolean }) {
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
              THIS DEVICE
            </span>
          )}
        </span>
        <span className="block text-sm text-ink2">Last seen {new Date(d.lastSeenAt).toLocaleString()}</span>
      </span>
      {!d.current && (
        <Button variant="outline" onClick={onRemove} disabled={busy}>
          Remove
        </Button>
      )}
    </li>
  );
}

export function AccountPage() {
  const { me, setMe, signOut } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState(me?.fullName ?? '');
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

  if (!me) return null;

  return (
    <Page>
      <div className="pt-4 flex flex-col gap-10 max-w-[720px]">
        <div>
          <p className="font-mono text-[11px] tracking-[0.14em] text-ink2 m-0">Borrower card</p>
          <h1 className="m-0 font-display font-extrabold text-[clamp(44px,7vw,64px)] leading-[0.95] tracking-[-0.05em]">
            Account<span className="text-teal-text">.</span>
          </h1>
        </div>

        <section
          aria-labelledby="profile-h"
          className="rounded-[22px] bg-card border border-line p-6 flex flex-col gap-4"
        >
          <h2 id="profile-h" className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
            Your name
          </h2>
          <p className="m-0 text-sm text-ink2">This appears in the watermark on every page you read.</p>
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
            Stay signed in on up to two devices at once. Remove an old device and add a replacement right
            away.
          </p>
          <ul className="list-none m-0 p-0 mt-2">
            {me.devices.map((d) =>
              confirming === d.id ? (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-4 border-b border-line">
                  <span className="flex-1 text-sm">
                    Remove <strong>{d.label}</strong>? It will be signed out immediately, and you can add a
                    replacement now.
                  </span>
                  <Button variant="ink" onClick={() => remove.mutate(d.id)} disabled={remove.isPending}>
                    {remove.isPending ? 'Removing…' : 'Yes, remove'}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </li>
              ) : (
                <DeviceRow key={d.id} d={d} busy={remove.isPending} onRemove={() => setConfirming(d.id)} />
              ),
            )}
          </ul>
          {remove.isError && <p className="text-sm text-blush-text">{friendly(remove.error)}</p>}
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
