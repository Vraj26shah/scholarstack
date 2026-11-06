import type { FeatureDto } from '@ss/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Hl, StackWord } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { ErrorState, Skeleton } from '../../shared/ui/feedback';
import { Check, Mail } from '../../shared/ui/icons';
import { Reveal } from '../../shared/ui/motion';
import { toolModule } from './registry';

/** "Tell me when it's ready": for signed-in students this is just the feature-email opt-in. */
export function NotifyMe({ feature }: { feature: FeatureDto }) {
  const { status, me, setMe } = useSession();
  const optIn = useMutation({ mutationFn: () => api.setEmailOptIn(true), onSuccess: setMe });
  if (feature.status === 'live') return null;
  if (status !== 'ready' || !me)
    return (
      <LinkButton to={`/sign-in?next=${encodeURIComponent(feature.path)}`} variant="outline">
        <Mail size={16} /> Notify me when it’s out
      </LinkButton>
    );
  if (me.emailOptIn)
    return (
      <span className="flex items-start gap-2 min-w-0 text-sm font-semibold text-teal-text">
        <Check size={16} className="flex-none mt-0.5" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          We'll email{' '}
          <span>
            {me.email.split('@')[0]}
            <wbr />@{me.email.split('@')[1]}
          </span>{' '}
          when it's out
        </span>
      </span>
    );
  return (
    <>
      <Button variant="outline" onClick={() => optIn.mutate()} disabled={optIn.isPending}>
        <Mail size={16} /> Email me when it's out
      </Button>
      {optIn.isError && <span className="text-sm text-blush-text">{friendly(optIn.error)}</span>}
    </>
  );
}

export function toolCardStatus(f: Pick<FeatureDto, 'key' | 'status'>) {
  const ready = !!toolModule(f.key);
  const live = f.status === 'live' && ready;
  return { ready, live, label: live ? 'Live' : 'Coming soon' } as const;
}

function ToolCard({ f, i }: { f: FeatureDto; i: number }) {
  const status = toolCardStatus(f);
  return (
    <Reveal index={i}>
      {/* A catalogue card from the drawer: call number, ruled lines, a rubber stamp. */}
      <article
        className="ruled relative flex h-full min-h-[302px] flex-col gap-4 rounded-[14px] px-5 pt-4 pb-11 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)]"
        style={{ backgroundPosition: '0 46px' }}
      >
        <div className="flex min-h-8 items-center justify-between gap-3">
          <span className="font-mono text-[12px] tracking-[0.08em] text-ink2">
            T-{String(i + 1).padStart(2, '0')}
          </span>
          <span
            role="status"
            aria-label={`Status: ${status.label}`}
            className={`stamp-land [--delay:0.18s] inline-flex h-8 min-w-[92px] items-center justify-center rounded-md border-2 bg-transparent px-3 font-mono text-[11px] font-bold uppercase tracking-[0.08em] ${
              status.live ? 'border-teal text-teal-text' : 'border-marigold text-marigold-text'
            }`}
          >
            {status.label}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="m-0 line-clamp-2 min-h-[3.25rem] font-display text-[26px] font-extrabold leading-[1.02] tracking-[-0.035em]">
            {f.title}
          </h3>
          <span className="line-clamp-3 min-h-[4.5rem] text-[15px] leading-relaxed text-ink2">{f.blurb}</span>
        </div>
        <div className="mt-auto flex min-h-11 flex-wrap items-center gap-3">
          {status.live ? (
            <LinkButton to={f.path} variant="brand">
              Open {f.title}
            </LinkButton>
          ) : !status.ready ? (
            <LinkButton to={f.path} variant="outline">
              Tool details
            </LinkButton>
          ) : (
            <NotifyMe feature={f} />
          )}
        </div>
        <span aria-hidden="true" className="punch-hole" />
      </article>
    </Reveal>
  );
}

/** Free tools anyone can use from the home page, no sign-in. Listed from the database. */
export function Toolbox() {
  const q = useQuery({ queryKey: ['features'], queryFn: api.features, staleTime: 60_000 });
  const tools = q.data ?? [];
  if (q.isSuccess && tools.length === 0) return null;
  return (
    <section
      id="toolbox"
      aria-labelledby="toolbox-title"
      className="mx-auto max-w-[1280px] px-5 sm:px-9 pt-24 pb-10"
    >
      <div className="flex flex-wrap items-end justify-between gap-5 mb-10">
        <div>
          <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">The toolbox</p>
          <h2
            id="toolbox-title"
            className="m-0 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
          >
            Free for <StackWord className="text-teal-text">everyone.</StackWord>
          </h2>
        </div>
        <p className="m-0 text-[17px] leading-relaxed text-ink2 max-w-[400px]">
          Free tools for students. <Hl>No sign-in needed.</Hl> Have an idea?{' '}
          <Link to="/contact" className="text-teal-text">
            tell us what you need
          </Link>
          .
        </p>
      </div>
      {q.isLoading ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5"
          role="status"
          aria-label="Loading tools"
        >
          <span className="sr-only">Loading tools…</span>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[302px] rounded-[14px]" />
          ))}
        </div>
      ) : q.isError && tools.length === 0 ? (
        <ErrorState
          title="The tools didn't load."
          message={friendly(q.error)}
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          {q.isError && (
            <p role="status" className="mb-4 rounded-xl bg-blush px-4 py-3 text-sm text-blush-text">
              Showing the last loaded tools. Refresh to check their current status.
              <Button variant="ghost" size="sm" onClick={() => void q.refetch()}>
                Refresh
              </Button>
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
            {tools.map((f, i) => (
              <ToolCard key={f.key} f={f} i={i} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
