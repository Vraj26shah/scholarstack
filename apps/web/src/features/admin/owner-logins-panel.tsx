import {
  MAX_OWNERS,
  type OwnerSetupCodeDto,
  formatMobile,
  isOwnerAddress,
  normaliseMobile,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Field, Note, Panel, input } from './ui';

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Kolkata',
      })
    : 'never';

/**
 * Admin › Campus › Owner logins: restaurant owners' sign-in to the Partner app (mobile + PIN).
 * Add a number (check it's theirs in person), read them the setup code, and they pick a PIN.
 */
export function OwnerLoginsPanel() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['admin-owner-logins'], queryFn: api.adminOwnerLogins });
  const messes = useQuery({ queryKey: ['messes'], queryFn: api.messes, staleTime: 60_000 });
  const restaurants = (messes.data ?? []).filter((m) => m.kind === 'restaurant');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<OwnerSetupCodeDto | null>(null);
  // Both lists: the sign-ins, and who can open each restaurant.
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin-owner-logins'] }),
      qc.invalidateQueries({ queryKey: ['admin-messes'] }),
    ]);

  const add = useMutation({
    mutationFn: () =>
      api.adminAddOwnerLogin({
        phone,
        name: name.trim(),
        messSlug: slug || restaurants[0]?.slug || '',
        ...(email.trim() ? { email: email.trim() } : {}),
      }),
    onSuccess: (c) => {
      setCode(c);
      setPhone('');
      setName('');
      setEmail('');
      void refresh();
    },
  });
  const act = useMutation({
    mutationFn: async ({ kind, phone: p }: { kind: 'code' | 'unlock' | 'remove'; phone: string }) => {
      if (kind === 'code') setCode(await api.adminOwnerSetupCode(p));
      if (kind === 'unlock') await api.adminOwnerUnlock(p);
      if (kind === 'remove') await api.adminOwnerRemove(p);
    },
    onSettled: () => void refresh(),
  });
  const valid = normaliseMobile(phone) !== null && (slug || restaurants[0]);

  return (
    <Panel title="Owner logins">
      <Note>
        Restaurant owners sign in to the Partner app (<code>/partner</code>) with their mobile number and a
        4-digit PIN. Check the number is theirs, add it here, and read them the 6-digit setup code: they type
        number + code and choose a PIN. Forgot it? Give a new code.
      </Note>

      {list.data && !list.data.available && (
        <p className="m-0 rounded-2xl bg-marigold-soft px-4 py-3 text-[14px] text-marigold-text">
          PIN sign-in is off on this server: set <code>OWNER_PIN_PEPPER</code> (in .env, then{' '}
          <code>pnpm github:secrets</code> and deploy).
        </p>
      )}

      {code && (
        <div
          className="rounded-2xl bg-brand text-white p-5 flex flex-wrap items-center justify-between gap-4"
          role="status"
        >
          <div>
            <p className="m-0 text-[13px] text-on-brand2">
              Setup code for {formatMobile(code.phone)} · valid till {when(code.expiresAt)}
            </p>
            <p className="m-0 font-mono text-[40px] font-bold tracking-[0.25em]">{code.code}</p>
            <p className="m-0 text-[13px] text-on-brand2">Read it to the owner. It is shown only now.</p>
          </div>
          <Button variant="outline-light" size="sm" onClick={() => setCode(null)}>
            Done
          </Button>
        </div>
      )}

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1fr_auto] items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) add.mutate();
        }}
      >
        <Field label="Mobile number">
          <input
            className={input}
            inputMode="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
        <Field label="Name (optional)">
          <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Restaurant">
          <select
            className={input}
            value={slug || restaurants[0]?.slug || ''}
            onChange={(e) => setSlug(e.target.value)}
          >
            {restaurants.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Their email (optional)">
          <input
            className={input}
            type="email"
            placeholder="leave empty if none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="brand" disabled={!valid || add.isPending}>
          {add.isPending ? 'Adding…' : 'Add & get code'}
        </Button>
      </form>
      {add.isError && <p className="m-0 text-[14px] font-semibold text-blush-text">{friendly(add.error)}</p>}
      <WhoCanOpen slug={slug || restaurants[0]?.slug || ''} />
      {act.isError && <p className="m-0 text-[14px] font-semibold text-blush-text">{friendly(act.error)}</p>}

      {list.isError ? (
        <ErrorState
          title="Owner logins didn't load."
          message={friendly(list.error)}
          onRetry={() => list.refetch()}
        />
      ) : list.isLoading ? (
        <Skeleton className="h-32 rounded-2xl" />
      ) : (list.data?.owners ?? []).length === 0 ? (
        <Note>No owners yet.</Note>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col">
          {list.data!.owners.map((o) => (
            <li
              key={o.phone}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3.5"
            >
              <div className="min-w-0">
                <p className="m-0 font-semibold">
                  {o.name || 'Owner'} · <span className="font-mono">{formatMobile(o.phone)}</span>
                </p>
                <p className="m-0 text-[13px] text-ink2">
                  {o.messes.map((m) => m.name).join(', ') || 'Not on any restaurant'} ·{' '}
                  {isOwnerAddress(o.email) ? 'no email' : o.email}
                </p>
                <p className="m-0 text-[13px] text-ink2">
                  {o.hasPin ? 'PIN set' : 'No PIN yet'}
                  {o.setupUntil && ` · setup code valid till ${when(o.setupUntil)}`}
                  {o.lockedUntil && (
                    <span className="text-blush-text font-semibold">
                      {' '}
                      · locked till {when(o.lockedUntil)}
                    </span>
                  )}
                  {` · last sign-in ${when(o.lastLoginAt)}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ kind: 'code', phone: o.phone })}
                >
                  New setup code
                </Button>
                {o.lockedUntil && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ kind: 'unlock', phone: o.phone })}
                  >
                    Unlock
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `Stop PIN sign-in for ${formatMobile(o.phone)}? (Remove them from the restaurant in Mess menus too, if they no longer run it.)`,
                      )
                    )
                      act.mutate({ kind: 'remove', phone: o.phone });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Everyone who can open the chosen restaurant's orders (Partner app numbers and email addresses),
 * with Remove, so a full restaurant can make room right here.
 */
function WhoCanOpen({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ['admin-messes'], queryFn: api.adminMesses });
  const mess = all.data?.find((m) => m.slug === slug);
  const remove = useMutation({
    mutationFn: async (email: string) => {
      if (!mess) return;
      const { sort: _s, updatedAt: _u, ...input } = mess;
      await api.adminSaveMess(mess.slug, {
        ...input,
        ownerEmails: mess.ownerEmails.filter((e) => e !== email),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-messes'] });
      void qc.invalidateQueries({ queryKey: ['admin-owner-logins'] });
    },
  });
  if (!slug) return null;
  if (!mess) return all.isLoading ? <Skeleton className="h-16 rounded-2xl" /> : null;
  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-sunk px-4 py-3">
      <h3 className="m-0 text-[15px] font-bold">
        Who can open {mess.name}{' '}
        <span className="font-normal text-ink2">
          · {mess.ownerEmails.length} of {MAX_OWNERS}
        </span>
      </h3>
      {mess.ownerEmails.length === 0 ? (
        <p className="m-0 text-[14px] text-ink2">Nobody yet. Add a number above.</p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line">
          {mess.ownerEmails.map((e) => (
            <li key={e} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-[14px]">
                {isOwnerAddress(e) ? (
                  <>
                    <strong className="tabular-nums">{formatMobile(e.slice(1, 11))}</strong>
                    <span className="text-ink2"> · Partner app</span>
                  </>
                ) : (
                  <span className="break-all">{e}</span>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Stop ${isOwnerAddress(e) ? formatMobile(e.slice(1, 11)) : e} opening ${mess.name}?`,
                    )
                  )
                    remove.mutate(e);
                }}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <p className="m-0 text-[13px] text-blush-text">{friendly(remove.error)}</p>}
    </section>
  );
}
