import { Link } from 'react-router-dom';
import { BlockerHelp } from '../../shared/ui/blocker-help';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import type { BuyProblem } from './use-buy';

const COPY: Record<Exclude<BuyProblem['kind'], 'closed'>, { title: string; lead: string; next: string }> = {
  declined: {
    title: 'Payment didn’t go through.',
    lead: 'Your bank or UPI app said:',
    next: 'Nothing was added to your shelf. If your account shows a debit, the bank reverses it automatically, usually within 5–7 working days. You can try again, or use another UPI app or card.',
  },
  blocked: {
    title: 'Your browser blocked the payment window.',
    lead: 'An ad or tracker blocker stopped Razorpay from loading. Nothing was charged.',
    next: '',
  },
  unavailable: {
    title: 'Payments are paused.',
    lead: 'We couldn’t open the payment window just now.',
    next: 'Nothing was charged. Please try again in a few minutes. If it keeps happening, tell us and we’ll sort it out.',
  },
  error: {
    title: 'Something went wrong.',
    lead: 'The purchase stopped before it finished:',
    next: 'If money left your account, don’t pay again: the course reaches your shelf within a few minutes, or contact us with the time you paid.',
  },
};

/** The result window for a purchase that didn't finish: what happened, whether money moved, what to do. */
export function PaymentProblem({
  problem,
  onRetry,
  onClose,
}: {
  problem: BuyProblem | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const open = Boolean(problem && problem.kind !== 'closed');
  const copy = problem && problem.kind !== 'closed' ? COPY[problem.kind] : null;
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={copy?.title ?? ''}>
      {copy && problem && (
        <>
          <div role="alert" className="flex flex-col gap-2">
            <p className="m-0 text-[15px] text-ink2">{copy.lead}</p>
            {problem.kind !== 'unavailable' && problem.kind !== 'blocked' && (
              <p className="m-0 rounded-xl bg-blush text-blush-text px-3.5 py-2.5 text-[15px] font-semibold">
                {problem.message}
              </p>
            )}
          </div>
          {problem.kind === 'blocked' ? (
            <BlockerHelp />
          ) : (
            <p className="m-0 text-[15px] leading-relaxed text-ink2">{copy.next}</p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="brand"
              onClick={() => {
                onClose();
                onRetry();
              }}
            >
              Try again
            </Button>
            <Button variant="outline" onClick={onClose}>
              Not now
            </Button>
          </div>
          <p className="m-0 text-[13px] text-ink2">
            Need help?{' '}
            <Link to="/contact" className="text-teal-text font-semibold" onClick={onClose}>
              Contact us
            </Link>
          </p>
        </>
      )}
    </Sheet>
  );
}
