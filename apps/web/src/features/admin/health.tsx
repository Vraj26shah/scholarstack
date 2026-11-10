import type { AdminSyncHealthDto } from '@ss/contracts';
import { Check, Cross } from '../../shared/ui/icons';
import { plural } from './ui';

/** One line when storage, database, page maker and payments all work; a card for each that doesn't. */
function HealthCard({
  title,
  plain,
  ok,
  message,
}: { title: string; plain: string; ok: boolean | null; message: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border-[1.5px] border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{title}</span>
        {ok === null ? (
          <span className="text-xs text-ink2">Checking…</span>
        ) : ok ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-teal-text">
            <Check size={15} /> Working
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-blush-text">
            <Cross size={15} /> Problem
          </span>
        )}
      </div>
      <p className="m-0 text-xs text-ink2">{plain}</p>
      <p className={`m-0 text-[13px] leading-snug ${ok === false ? 'text-blush-text' : 'text-ink'}`}>
        {message}
      </p>
    </div>
  );
}

export function Health({ health }: { health: AdminSyncHealthDto | undefined }) {
  if (!health)
    return (
      <p className="m-0 text-sm text-ink2">Checking storage, website, page maker, payments and email…</p>
    );
  const mode = health.payments.mode === 'live' ? '' : health.payments.mode === 'test' ? ' (test mode)' : '';
  const cards = [
    {
      title: 'File storage',
      plain: 'Where the original files live.',
      ok: health.r2.status === 'connected',
      message: health.r2.message,
    },
    {
      title: 'Website database',
      plain: 'Courses, prices and page lists.',
      ok: health.supabase.status === 'connected',
      message: health.supabase.message,
    },
    {
      title: 'Page maker',
      plain: 'Turns files into protected pages.',
      ok: health.conversion.status === 'ready',
      message: health.conversion.message,
    },
    {
      title: `Payments${mode}`,
      plain: "Takes students' money at checkout.",
      ok: health.payments.status === 'connected',
      message: health.payments.message ?? '',
    },
    ...(health.email
      ? [
          {
            title: 'Email',
            plain: 'Access, upload and reply emails to students.',
            ok: health.email.status === 'connected',
            message: health.email.message,
          },
        ]
      : []),
  ];
  const broken = cards.filter((c) => !c.ok);
  if (broken.length === 0)
    return (
      <p className="m-0 inline-flex flex-wrap items-center gap-1.5 text-sm text-ink2">
        <Check size={15} className="text-teal-text" />
        Storage, website, page maker, payments{mode} and email are all working
        {health.conversion.queuedJobs
          ? ` · ${plural(health.conversion.queuedJobs, 'file')} waiting for pages`
          : ''}
        .
      </p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {broken.map((c) => (
        <HealthCard key={c.title} title={c.title} plain={c.plain} ok={false} message={c.message} />
      ))}
    </div>
  );
}
