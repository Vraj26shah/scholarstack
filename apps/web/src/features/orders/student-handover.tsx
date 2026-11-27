import { HANDOVER, type MessOrderDto, type TiffinMealDto } from '@ss/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';

const btn =
  'press inline-flex h-10 items-center justify-center rounded-xl px-4 text-[14px] font-semibold cursor-pointer disabled:opacity-50';
const solid = `${btn} bg-ink text-bg`;
const outline = `${btn} border-[1.5px] border-line bg-surface text-ink`;
const link =
  'border-0 bg-transparent p-0 text-[13.5px] font-semibold text-ink2 underline underline-offset-4 cursor-pointer';

/** The 4 digits, big enough to read across a counter. */
function CodeDigits({ code, label }: { code: string; label: string }) {
  return (
    <span
      aria-label={`${label} ${code.split('').join(' ')}`}
      className="font-mono text-[30px] leading-none font-extrabold tracking-[0.3em] tabular-nums text-ink"
    >
      {code}
    </span>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['my-mess-orders'] });
    void qc.invalidateQueries({ queryKey: ['order-standing'] });
  };
}

/**
 * The student's side of handing food over: the secret code to give the restaurant once the food is
 * in their hands, "I got it", and saying when it never came (or a "didn't collect" is wrong).
 */
export function StudentHandover({ order: o }: { order: MessOrderDto }) {
  const refresh = useRefresh();
  const [contest, setContest] = useState(false);
  const [note, setNote] = useState('');
  const got = useMutation({ mutationFn: () => api.confirmReceived(o.id), onSuccess: refresh });
  const dispute = useMutation({
    mutationFn: () => api.disputeOrder(o.id, o.canDispute as 'not_received' | 'no_show', note.trim()),
    onSuccess: () => {
      setContest(false);
      refresh();
    },
  });
  const err = got.error ?? dispute.error;
  const showCode = !!o.handoverCode && (o.status === 'accepted' || o.status === 'ready');
  const askedToConfirm = o.status === 'done' && o.handoverHow === 'owner' && o.canConfirm;

  let disputeLine = '';
  if (o.dispute) {
    const what =
      o.dispute.kind === 'no_show' ? 'You said you did collect it.' : "You said it didn't reach you.";
    disputeLine =
      o.dispute.state === 'open'
        ? `${what} The admin will look at it${o.dispute.kind === 'no_show' ? '; until then it does not count against you' : ''}.`
        : o.dispute.state === 'student'
          ? `${what} The admin sided with you.`
          : o.dispute.state === 'owner'
            ? `${what} The admin sided with the restaurant.`
            : 'Settled: your code was entered, so it reached you.';
  }

  if (!showCode && !askedToConfirm && !o.canDispute && !o.canConfirm && !disputeLine) return null;
  return (
    <div className="flex flex-col gap-2.5">
      {showCode && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl bg-teal/10 px-3.5 py-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-teal-text">
              Your handover code
            </span>
            <span className="text-[13px] text-ink2">
              Tell it to the restaurant only once the food is in your hands.
            </span>
          </div>
          <CodeDigits code={o.handoverCode} label="Handover code" />
        </div>
      )}
      {askedToConfirm && (
        <div className="flex flex-col gap-2 rounded-xl bg-marigold-soft px-3.5 py-3 text-marigold-text">
          <p className="m-0 text-[14px] font-semibold">
            {o.messName} marked it handed over without your code. Did you get it?
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={got.isPending} onClick={() => got.mutate()} className={solid}>
              Yes, I got it
            </button>
            {o.canDispute === 'not_received' && !contest && (
              <button type="button" onClick={() => setContest(true)} className={outline}>
                No, I didn't
              </button>
            )}
          </div>
        </div>
      )}
      {!askedToConfirm && o.canConfirm && (o.status === 'accepted' || o.status === 'ready') && (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <button type="button" disabled={got.isPending} onClick={() => got.mutate()} className={link}>
            I got my food
          </button>
          {o.canDispute === 'not_received' && !contest && (
            <button type="button" onClick={() => setContest(true)} className={link}>
              It never came
            </button>
          )}
        </div>
      )}
      {o.dispute?.state === 'open' && o.canConfirm && (
        <button
          type="button"
          disabled={got.isPending}
          onClick={() => got.mutate()}
          className={`self-start ${link}`}
        >
          It reached me after all
        </button>
      )}
      {o.canDispute === 'no_show' && !contest && (
        <p className="m-0 text-[13.5px] text-ink2">
          Did you collect it after all?{' '}
          <button type="button" onClick={() => setContest(true)} className={link}>
            Tell the admin
          </button>{' '}
          (within {HANDOVER.answerHours} hours).
        </p>
      )}
      {contest && (
        <form
          className="flex flex-col gap-2 rounded-xl bg-sunk px-3.5 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            dispute.mutate();
          }}
        >
          <span className="text-[13.5px] font-semibold text-ink">
            {o.canDispute === 'no_show'
              ? 'What happened? The admin reads this and decides.'
              : "What happened? The restaurant is told, and the admin decides. Never give your code for food you didn't get."}
          </span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="A few words (optional)"
            aria-label="What happened"
            className="h-10 rounded-lg border-[1.5px] border-line bg-surface px-3 text-[14px] outline-none focus:border-teal"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={dispute.isPending} className={solid}>
              {dispute.isPending ? 'Sending…' : 'Send'}
            </button>
            <button type="button" onClick={() => setContest(false)} className={outline}>
              Back
            </button>
          </div>
        </form>
      )}
      {disputeLine && <p className="m-0 text-[13.5px] font-semibold text-ink">{disputeLine}</p>}
      {err && (
        <p role="alert" className="m-0 text-[13px] text-blush-text">
          {friendly(err)}
        </p>
      )}
    </div>
  );
}

const MEAL = { lunch: 'Lunch', dinner: 'Dinner' } as const;
const dayText = (iso: string) =>
  new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });

/** Today's tiffin meals with their codes, and deliveries marked without a code to confirm. */
export function TiffinMeals({ order }: { order: MessOrderDto }) {
  const qc = useQueryClient();
  const meals = order.tiffin?.meals ?? [];
  const answer = useMutation({
    mutationFn: ({ m, a }: { m: TiffinMealDto; a: 'yes' | 'no' }) =>
      api.confirmTiffin({ orderId: order.id, day: m.day, meal: m.meal, makeupFor: m.makeupFor, answer: a }),
    onSuccess: (list) => qc.setQueryData(['my-mess-orders'], list),
  });
  if (!meals.length) return null;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-2">
      {meals.map((m) => {
        const name = `${MEAL[m.meal]}${m.makeupFor ? ` (make-up for ${dayText(m.makeupFor)})` : ''} · ${dayText(m.day)}`;
        const marked = m.mark === 'delivered' && m.how === 'owner';
        return (
          <li
            key={`${m.day}-${m.meal}-${m.makeupFor}`}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-sunk px-3.5 py-2.5"
          >
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[14px] font-semibold text-ink">{name}</span>
              <span className="text-[13px] text-ink2">
                {m.code
                  ? 'Give this code when the tiffin is in your hands.'
                  : m.mark === 'missed'
                    ? 'Marked missed.'
                    : m.how === 'code'
                      ? 'Delivered · your code ✓'
                      : m.how === 'student'
                        ? 'You said you got it.'
                        : marked
                          ? m.confirm === 'no'
                            ? "You said it didn't come. The admin will look at it."
                            : m.confirm === 'yes'
                              ? 'You confirmed it.'
                              : 'Marked delivered without your code. Did you get it?'
                          : ''}
              </span>
            </div>
            {m.code && <CodeDigits code={m.code} label={`${MEAL[m.meal]} code`} />}
            {m.canAnswer && (
              <div className="flex gap-2">
                {(m.mark === null || m.confirm !== 'yes') && (
                  <button
                    type="button"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ m, a: 'yes' })}
                    className={m.mark === null ? link : solid}
                  >
                    {m.mark === null ? 'I got it' : 'Yes, got it'}
                  </button>
                )}
                {marked && m.confirm !== 'no' && (
                  <button
                    type="button"
                    disabled={answer.isPending}
                    onClick={() => answer.mutate({ m, a: 'no' })}
                    className={outline}
                  >
                    No
                  </button>
                )}
              </div>
            )}
          </li>
        );
      })}
      {answer.error && (
        <li role="alert" className="text-[13px] text-blush-text">
          {friendly(answer.error)}
        </li>
      )}
    </ul>
  );
}
