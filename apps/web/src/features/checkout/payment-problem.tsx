import { Link } from 'react-router-dom';
import { BlockerHelp } from '../../shared/ui/blocker-help';
import { Stamp } from '../../shared/ui/brand';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import type { BuyProblem } from './use-buy';

const COPY: Record<BuyProblem['kind'], { title: string; lead: string; next: string }> = {
  closed: {
    title: 'You closed the payment window.',
    lead: 'The checkout was closed before the payment went through.',
    next: 'Nothing was charged. Whenever you’re ready, try again — the course is still waiting.',
  },
  declined: {
    title: 'Payment didn’t go through.',
    lead: 'Your bank or UPI app said:',
    next: 'Nothing was added to your shelf. If your account shows a debit, the bank reverses it automatically, usually within 5–7 working days. You can try again, or use another UPI app or card.',
  },
  blocked: {
    title: 'Your browser blocked the payment window.',
    lead: 'An ad or tracker blocker stopped the payment window from loading. Nothing was charged.',
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

/**
 * The result window for a purchase that didn't finish: a "NOT PAID" stamp, what happened,
 * whether money moved, and what to do next. Bottom sheet on phones, centred card on laptops.
 * Every problem opens this — a failure is never left as a quiet note under the buy button.
 */
export function PaymentProblem({
  problem,
  onRetry,
  onClose,
}: {
  problem: BuyProblem | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const copy = problem ? COPY[problem.kind] : null;
  return (
    <Sheet open={!!problem} onOpenChange={(o) => !o && onClose()} title={copy?.title ?? ''}>
      {copy && problem && (
        <>
          <div className="flex items-center gap-5 pt-1">
            <Stamp
              label="NOT PAID"
              ring="PAYMENT · NOT COMPLETED · "
              size={104}
              rotate={-12}
              tone="blush"
              animate
              delay={0.1}
            />
            <p role="alert" className="m-0 flex-1 min-w-0 text-[15px] leading-relaxed text-ink2">
              {copy.lead}
              {problem.kind !== 'unavailable' && problem.kind !== 'blocked' && problem.kind !== 'closed' && (
                <span className="mt-2 block rounded-xl bg-blush text-blush-text px-3.5 py-2.5 text-[15px] font-semibold break-words">
                  {problem.message}
                </span>
              )}
            </p>
          </div>
          {problem.kind === 'blocked' ? (
            <BlockerHelp />
          ) : (
            <p className="m-0 text-[15px] leading-relaxed text-ink2">{copy.next}</p>
          )}
          <div className="flex flex-wrap gap-2.5 pt-1">
            <Button
              variant="brand"
              size="lg"
              onClick={() => {
                onClose();
                onRetry();
              }}
            >
              Try again
            </Button>
            <Button variant="outline" size="lg" onClick={onClose}>
              Not now
            </Button>
          </div>
          <p className="m-0 text-[13px] text-ink2">
            Need help?{' '}
            <Link to="/contact" className="text-teal-text font-semibold" onClick={onClose}>
              Contact us
            </Link>{' '}
            with what you saw.
          </p>
        </>
      )}
    </Sheet>
  );
}
