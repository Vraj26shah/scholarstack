import type { FeatureDto } from '@ss/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { StackWord } from '../../shared/ui/brand';
import { Button, LinkButton } from '../../shared/ui/button';
import { Check, Mail } from '../../shared/ui/icons';
import { Reveal } from '../../shared/ui/motion';
import { ToolIcon } from './tool-icon';

/** "Tell me when it's ready": for signed-in students this is just the feature-email opt-in. */
export function NotifyMe({ feature }: { feature: FeatureDto }) {
  const { status, me, setMe } = useSession();
  const optIn = useMutation({ mutationFn: () => api.setEmailOptIn(true), onSuccess: setMe });
  if (feature.status === 'live') return null;
  if (status !== 'ready' || !me)
    return (
      <LinkButton to={`/sign-in?next=${encodeURIComponent(feature.path)}`} variant="outline">
        <Mail size={16} /> Sign in to get an email when it's out
      </LinkButton>
    );
  if (me.emailOptIn)
    return (
      <span className="inline-flex items-center gap-2 text-sm font-semibold text-teal-text">
        <Check size={16} /> We'll email {me.email} when it's out
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

function ToolCard({ f, i }: { f: FeatureDto; i: number }) {
  const live = f.status === 'live';
  return (
    <Reveal index={i}>
      <div
        className={`relative h-full rounded-[24px] p-6 flex flex-col gap-4 border ${
          live ? 'bg-surface border-teal shadow-[0_20px_40px_-28px_var(--shadow)]' : 'bg-surface border-line'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className={`w-14 h-14 rounded-2xl inline-flex items-center justify-center ${
              live ? 'bg-teal text-white' : 'bg-sunk text-ink2'
            }`}
          >
            <ToolIcon toolKey={f.key} />
          </span>
          <span
            className={`inline-flex items-center h-7 px-3 rounded-full font-mono text-[11px] font-semibold tracking-[0.1em] ${
              live ? 'bg-mist text-on-mist' : 'bg-marigold-soft text-marigold-text'
            }`}
          >
            {live ? 'FREE · NO SIGN-IN' : 'COMING SOON'}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="font-display font-extrabold text-[26px] leading-none tracking-[-0.035em]">
            {f.title}
          </span>
          <span className="text-[15px] leading-relaxed text-ink2">{f.blurb}</span>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-3">
          {live ? (
            <LinkButton to={f.path} variant="brand">
              Open {f.title.toLowerCase()} →
            </LinkButton>
          ) : (
            <NotifyMe feature={f} />
          )}
        </div>
      </div>
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
          <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">
            04 — THE TOOLBOX
          </p>
          <h2
            id="toolbox-title"
            className="m-0 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
          >
            Free for <StackWord className="text-teal-text">everyone.</StackWord>
          </h2>
        </div>
        <p className="m-0 text-[17px] leading-relaxed text-ink2 max-w-[400px]">
          Small tools for the rest of the semester. No sign-in, no payment. More on the way:{' '}
          <Link to="/contact" className="text-teal-text">
            tell us what you need
          </Link>
          .
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5">
        {tools.map((f, i) => (
          <ToolCard key={f.key} f={f} i={i} />
        ))}
      </div>
    </section>
  );
}
