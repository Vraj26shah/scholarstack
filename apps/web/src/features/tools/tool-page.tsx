import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { BackLink } from '../../shared/ui/back-link';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Skeleton, Spinner } from '../../shared/ui/feedback';
import { toolModule } from './registry';
import { ToolIcon } from './tool-icon';
import { NotifyMe } from './toolbox';

/** /tools/:key — the tool itself when it's built and live, otherwise a "coming soon" card. Public. */
export function ToolPage() {
  const { key = '' } = useParams();
  const q = useQuery({ queryKey: ['features'], queryFn: api.features, staleTime: 60_000 });
  const feature = q.data?.find((f) => f.key === key);
  const Screen = toolModule(key)?.screen;
  const { me } = useSession();

  if (q.isLoading)
    return (
      <Page>
        <Skeleton className="h-64 mt-6" />
      </Page>
    );

  // Admins can try a built tool before launching it; students still see "coming soon".
  const preview = me?.isAdmin && feature?.status !== 'live' && Screen;
  if ((feature?.status === 'live' || preview) && Screen)
    return (
      <Page wide>
        {preview && (
          <p className="m-0 mt-4 rounded-xl bg-marigold-soft px-4 py-3 text-[14px] text-marigold-text">
            <strong>Admin preview.</strong> Students see "Coming soon" until you press Launch in Admin ›
            Emails.
          </p>
        )}
        <Suspense fallback={<Spinner label={`Loading ${feature?.title ?? 'the tool'}`} />}>
          <Screen />
        </Suspense>
      </Page>
    );

  return (
    <Page>
      <div className="pt-6 max-w-[640px] flex flex-col items-start gap-6">
        <span className="w-16 h-16 rounded-2xl bg-sunk text-ink2 inline-flex items-center justify-center">
          <ToolIcon toolKey={key} size={30} />
        </span>
        <p className="m-0 text-[13px] font-semibold text-marigold-text">Coming soon</p>
        <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,72px)] leading-[0.95] tracking-[-0.05em]">
          {feature?.title ?? 'This tool'} is on the workbench.
        </h1>
        <p className="m-0 text-lg leading-relaxed text-ink2">
          {feature?.blurb ?? "It isn't ready yet."} It'll be free and work without signing in.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {feature && <NotifyMe feature={feature} />}
          <BackLink
            fallback="/#toolbox"
            className="inline-flex items-center h-11 px-4 rounded-full border-0 bg-transparent text-ink font-semibold cursor-pointer hover:bg-sunk"
          />
        </div>
      </div>
    </Page>
  );
}
