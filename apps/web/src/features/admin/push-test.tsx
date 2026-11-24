import type { AdminPushDeviceDto } from '@ss/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { input } from './ui';

const time = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * The devices that just got a test, re-checked every few seconds for 40 s: each says whether it
 * showed the notification ("✓ Showed it") or not yet, so the admin knows exactly which work.
 */
export function DeviceReceipts({
  emails,
  sentAt,
  results,
}: {
  emails: string[];
  /** When the test went out (a device that showed something after this showed the test). */
  sentAt: number;
  /** What each push service said, by device id. */
  results: Record<string, AdminPushDeviceDto['result']>;
}) {
  const q = useQuery({
    queryKey: ['admin-push-devices', emails.join(','), sentAt],
    queryFn: () => api.adminPushDevices(emails),
    refetchInterval: (r) => (Date.now() - sentAt < 40_000 ? 4_000 : false),
  });
  const devices = q.data ?? [];
  const waiting = Date.now() - sentAt < 40_000;
  if (!devices.length) return null;
  return (
    <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-xl bg-sunk px-4">
      {devices.map((d) => {
        const shown = !!d.seenAt && Date.parse(d.seenAt) >= sentAt - 2_000;
        const result = results[d.id];
        return (
          <li key={d.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 py-2.5 text-[14px]">
            <span className="flex-1 min-w-[200px]">
              <strong className="text-ink">{d.label}</strong>
              <span className="block text-[12.5px] text-ink2">
                {d.summary} · added {time(d.createdAt)}
                {d.seenAt && !shown ? ` · last showed one ${time(d.seenAt)}` : ''}
              </span>
            </span>
            <span
              className={`font-semibold ${
                shown
                  ? 'text-teal-text'
                  : result === 'gone' || result === 'failed' || !waiting
                    ? 'text-blush-text'
                    : 'text-ink2'
              }`}
            >
              {shown
                ? `✓ Showed it ${time(d.seenAt!)}`
                : result === 'gone'
                  ? '✗ Switched off by the browser (removed)'
                  : result === 'failed'
                    ? '✗ The push service refused it'
                    : waiting
                      ? 'Sent, waiting for the device…'
                      : '✗ Not confirmed: the browser is closed, offline, or blocking notifications'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Admin › Campus › Reminders: send a test to anyone's devices by their email. */
export function PersonTest() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<{
    email: string;
    at: number;
    results: Record<string, AdminPushDeviceDto['result']>;
  } | null>(null);
  const send = useMutation({
    mutationFn: (e: string) => api.adminPushTestPerson(e),
    onMutate: () => setSent(null),
    onSuccess: (list, e) =>
      setSent({
        email: e,
        at: Date.now() - 1_000,
        results: Object.fromEntries(list.map((d) => [d.id, d.result])),
      }),
  });
  const ok = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  return (
    <section aria-label="Test a person's notifications" className="flex flex-col gap-3 max-w-[760px]">
      <h3 className="m-0 text-[17px] font-bold text-ink">Test anyone's notifications</h3>
      <p className="m-0 text-[14px] text-ink2">
        Type a student's or restaurant owner's email. Every device of theirs with notifications on gets a
        test, and each one reports back when it shows it.
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) send.mutate(email.trim().toLowerCase());
        }}
      >
        <input
          className={`${input} flex-1 min-w-[240px]`}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@vitbhopal.ac.in or owner@gmail.com"
          aria-label="Their email"
          type="email"
        />
        <Button type="submit" variant="brand" disabled={!ok || send.isPending}>
          {send.isPending ? 'Sending…' : 'Send a test'}
        </Button>
      </form>
      {send.error && <p className="m-0 text-[14px] text-blush-text">{friendly(send.error)}</p>}
      {sent && <DeviceReceipts emails={[sent.email]} sentAt={sent.at} results={sent.results} />}
    </section>
  );
}
