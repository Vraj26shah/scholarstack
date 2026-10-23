import { useQuery } from '@tanstack/react-query';
import { Suspense } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';
import { Skeleton, Spinner } from '../../shared/ui/feedback';
import { TOOL_SCREENS } from './registry';
import { ToolIcon } from './tool-icon';
import { NotifyMe } from './toolbox';

/** /tools/:key — the tool itself when it's built and live, otherwise a "coming soon" card. Public. */
export function ToolPage() {
  const { key = '' } = useParams();
  const q = useQuery({ queryKey: ['features'], queryFn: api.features, staleTime: 60_000 });
  const feature = q.data?.find((f) => f.key === key);
  const Screen = TOOL_SCREENS[key];

  if (q.isLoading)
    return (
      <Page>
        <Skeleton className="h-64 mt-6" />
      </Page>
    );

  if (feature?.status === 'live' && Screen)
    return (
      <Page wide>
        <Suspense fallback={<Spinner label={`Loading ${feature.title}`} />}>
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
        <p className="m-0 font-mono text-[11px] tracking-[0.14em] text-marigold-text">COMING SOON</p>
        <h1 className="m-0 font-display font-extrabold text-[clamp(44px,8vw,72px)] leading-[0.95] tracking-[-0.05em]">
          {feature?.title ?? 'This tool'} is on the workbench.
        </h1>
        <p className="m-0 text-lg leading-relaxed text-ink2">
          {feature?.blurb ?? "It isn't ready yet."} It'll be free and work without signing in.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {feature && <NotifyMe feature={feature} />}
          <LinkButton to="/#toolbox" variant="ghost">
            Back to the toolbox
          </LinkButton>
        </div>
      </div>
    </Page>
  );
}
