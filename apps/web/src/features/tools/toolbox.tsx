import type { FeatureDto } from '@ss/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Hl, StackWord } from '../../shared/ui/brand';
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

function ToolCard({ f, i }: { f: FeatureDto; i: number }) {
  const live = f.status === 'live';
  return (
    <Reveal index={i}>
      {/* A catalogue card from the drawer: call number, ruled lines, a rubber stamp. */}
      <div
        className="ruled relative h-full rounded-[14px] px-5 pt-4 pb-11 flex flex-col gap-3 shadow-[0_18px_34px_-24px_var(--shadow),0_0_0_1px_var(--line)]"
        style={{ backgroundPosition: '0 46px' }}
      >
        <div className="flex justify-between gap-3 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
          <span>TOOL · {String(i + 1).padStart(2, '0')}</span>
          <span>{live ? 'ON THE SHELF' : 'ON ORDER'}</span>
        </div>
        <span
          aria-hidden="true"
          className={`absolute right-4 top-11 rotate-[-7deg] rounded-md border-2 px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-[0.06em] ${
            live ? 'border-teal-text text-teal-text' : 'border-marigold-text text-marigold-text'
          }`}
        >
          {live ? 'FREE · NO SIGN-IN' : 'COMING SOON'}
        </span>
        <div className="flex flex-col gap-1.5 pt-6">
          <span className="sr-only">{live ? 'Free, no sign-in.' : 'Coming soon.'}</span>
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
        <span aria-hidden="true" className="punch-hole" />
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
          <p className="font-mono text-[13px] tracking-[0.14em] text-teal-text m-0 mb-3.5">The toolbox</p>
          <h2
            id="toolbox-title"
            className="m-0 font-display font-extrabold text-[clamp(44px,6vw,76px)] leading-[0.95] tracking-[-0.05em]"
          >
            Free for <StackWord className="text-teal-text">everyone.</StackWord>
          </h2>
        </div>
        <p className="m-0 text-[17px] leading-relaxed text-ink2 max-w-[400px]">
          Small tools for the rest of the semester. <Hl>No sign-in, no payment.</Hl> More on the way:{' '}
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
