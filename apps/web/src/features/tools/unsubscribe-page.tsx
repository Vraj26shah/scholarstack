import { useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button, LinkButton } from '../../shared/ui/button';
import { Page } from '../../shared/ui/chrome';

/** From the link in an announcement email. Needs a click (mail scanners only follow links). */
export function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const stop = useMutation({ mutationFn: () => api.unsubscribe(token) });
  return (
    <Page>
      <div className="pt-6 max-w-[560px] flex flex-col items-start gap-5">
        <h1 className="m-0 font-display font-extrabold text-[clamp(40px,8vw,64px)] leading-[0.95] tracking-[-0.05em]">
          {stop.isSuccess ? 'Done. No more emails.' : 'Stop feature emails?'}
        </h1>
        <p className="m-0 text-lg leading-relaxed text-ink2">
          {stop.isSuccess
            ? "You won't get announcements about new courses or tools. Sign-in codes still arrive as usual. You can switch them back on in Account."
            : 'We only email when there are new courses or free tools. Sign-in codes are separate and keep working.'}
        </p>
        {!stop.isSuccess &&
          (token ? (
            <Button variant="ink" size="lg" onClick={() => stop.mutate()} disabled={stop.isPending}>
              {stop.isPending ? 'One moment…' : 'Yes, stop these emails'}
            </Button>
          ) : (
            <p className="m-0 text-sm text-blush-text">
              This link is incomplete. Use the link from the email, or turn emails off in Account.
            </p>
          ))}
        {stop.isError && <p className="m-0 text-sm text-blush-text">{friendly(stop.error)}</p>}
        <LinkButton to="/" variant="ghost">
          Back to the catalogue
        </LinkButton>
      </div>
    </Page>
  );
}
