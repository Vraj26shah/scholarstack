import type { MessOrderDto } from '@ss/contracts';
import { useState } from 'react';

/** The words the code box uses (English on the website, Hindi or English in the Partner app). */
export interface HandoverLabels {
  /** "Student's 4-digit code" */
  codeLabel: string;
  /** "Hand over" */
  submit: string;
  /** "No code? Hand over without it" */
  without: string;
  /** What "without" means, asked once before doing it. */
  withoutSure: string;
  /** "Yes, hand over" */
  withoutYes: string;
  back: string;
}

export const HANDOVER_EN: HandoverLabels = {
  codeLabel: "Student's 4-digit code",
  submit: 'Hand over',
  without: 'No code? Hand over without it',
  withoutSure:
    "Without the code, the student is asked whether they got it. If they say no, the admin decides. Ask for the code when you can: it's your proof.",
  withoutYes: 'Yes, hand over without code',
  back: 'Back',
};

/**
 * Typing the student's code when the food is handed over. The code is on the student's order
 * screen; with it, the handover is proved. Without it (phone dead, left at the door) the
 * restaurant can still hand over, and the student is asked to confirm.
 */
export function CodeEntry({
  labels,
  busy,
  onCode,
  onWithout,
  big = false,
  buttonClass,
  quietClass,
}: {
  labels: HandoverLabels;
  busy: boolean;
  onCode: (code: string) => void;
  onWithout?: () => void;
  /** The Partner app's big touch targets. */
  big?: boolean;
  buttonClass: string;
  quietClass: string;
}) {
  const [code, setCode] = useState('');
  const [asking, setAsking] = useState(false);
  const ready = /^\d{4}$/.test(code);
  if (asking && onWithout)
    return (
      <div className={`flex flex-col gap-2.5 rounded-2xl bg-sunk ${big ? 'px-4 py-3' : 'px-3 py-2.5'}`}>
        <p className={`m-0 ${big ? 'text-[16px] font-semibold' : 'text-[13.5px]'} text-ink`}>
          {labels.withoutSure}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={onWithout} className={buttonClass}>
            {labels.withoutYes}
          </button>
          <button type="button" onClick={() => setAsking(false)} className={quietClass}>
            {labels.back}
          </button>
        </div>
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onCode(code);
      }}
    >
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={4}
          placeholder="• • • •"
          aria-label={labels.codeLabel}
          className={`min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-surface text-center font-mono font-extrabold tracking-[0.4em] tabular-nums text-ink outline-none focus:border-teal ${big ? 'h-14 text-[26px]' : 'h-11 text-[20px]'}`}
        />
        <button type="submit" disabled={busy || !ready} className={`${buttonClass} disabled:opacity-40`}>
          ✓ {labels.submit}
        </button>
      </div>
      {onWithout && (
        <button type="button" onClick={() => setAsking(true)} className={`self-start ${quietClass}`}>
          {labels.without}
        </button>
      )}
    </form>
  );
}

/** One line for the restaurant on how a finished order was handed over, or what's contested. */
export function ownerHandoverText(o: MessOrderDto): { text: string; bad: boolean } | null {
  if (o.dispute) {
    const open = o.dispute.state === 'open';
    const decided =
      o.dispute.state === 'student'
        ? ' The admin sided with the student.'
        : o.dispute.state === 'owner'
          ? ' The admin sided with you.'
          : o.dispute.state === 'settled'
            ? ' Settled: it reached them.'
            : ' The admin will decide.';
    const what =
      o.dispute.kind === 'no_show'
        ? `${o.name} says they did collect it.`
        : `${o.name} says it never reached them.${open ? ' If it did, type their code.' : ''}`;
    return { text: `⚠ ${what}${decided}`, bad: open };
  }
  if (o.status !== 'done' || o.tiffin) return null;
  if (o.handoverHow === 'code') return { text: "✓ Handed over · student's code matched", bad: false };
  if (o.handoverHow === 'student') return { text: '✓ The student said they got it', bad: false };
  if (o.handoverHow === 'owner')
    return { text: 'Handed over without the code · waiting for the student to confirm', bad: false };
  return null;
}
