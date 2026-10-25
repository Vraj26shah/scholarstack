import type { SupportQueryDto } from '@ss/contracts';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Thread } from './thread';
import { STATUS_LABEL, TOPICS, when } from './topics';
import { useReply } from './use-support';

const TONE = {
  open: 'border-marigold-text text-marigold-text',
  answered: 'border-teal-text text-teal-text',
  closed: 'border-ink2 text-ink2',
} as const;

function Question({ q, i }: { q: SupportQueryDto; i: number }) {
  const [open, setOpen] = useState(q.status === 'answered');
  const [body, setBody] = useState('');
  const { reply, close } = useReply(q.id);
  const error = reply.error ?? close.error;
  return (
    <li className="relative rounded-[16px] bg-card shadow-[0_14px_30px_-26px_var(--shadow),0_0_0_1px_var(--line)] min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full text-left px-5 pt-4 pb-4 flex flex-col gap-2"
      >
        <span className="flex justify-between gap-3 font-mono text-[11px] text-ink2 pb-2 border-b-2 border-card-head">
          <span>
            NO. {String(i).padStart(2, '0')} · {TOPICS[q.topic].label.toUpperCase()}
          </span>
          <span>{when(q.updatedAt)}</span>
        </span>
        <span
          aria-hidden="true"
          className={`absolute right-4 top-11 rotate-[-6deg] rounded-md border-2 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-[0.06em] bg-card ${TONE[q.status]}`}
        >
          {STATUS_LABEL[q.status].toUpperCase()}
        </span>
        <span className="sr-only">Status: {STATUS_LABEL[q.status]}.</span>
        <span className="pr-32 font-display font-extrabold text-[20px] leading-tight tracking-[-0.03em] [overflow-wrap:anywhere]">
          {q.subject}
        </span>
      </button>
      {open && (
        <div className="px-5 pb-5 flex flex-col gap-4">
          <Thread messages={q.messages} />
          {q.files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.files.map((f) => (
                <Button
                  key={f.index}
                  size="sm"
                  variant="ghost"
                  onClick={() => void api.downloadMySupportFile(q.id, f.index, f.name)}
                >
                  {f.name}
                </Button>
              ))}
            </div>
          )}
          {q.status !== 'closed' && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2">
                Reply
                <textarea
                  className="h-24 w-full min-w-0 rounded-xl bg-surface border-[1.5px] border-line px-3 py-2.5 text-[15px] text-ink outline-none focus:border-teal resize-y"
                  value={body}
                  maxLength={4000}
                  onChange={(e) => setBody(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => reply.mutate(body, { onSuccess: () => setBody('') })}
                  disabled={reply.isPending || !body.trim()}
                >
                  {reply.isPending ? 'Sending…' : 'Send reply'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => close.mutate()} disabled={close.isPending}>
                  It's sorted, close it
                </Button>
              </div>
            </>
          )}
          {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
        </div>
      )}
    </li>
  );
}

export function MyQuestions({ items }: { items: SupportQueryDto[] }) {
  if (items.length === 0) return <p className="m-0 text-[15px] text-ink2">Nothing yet.</p>;
  return (
    <ul className="m-0 p-0 list-none flex flex-col gap-4">
      {items.map((q, i) => (
        <Question key={q.id} q={q} i={items.length - i} />
      ))}
    </ul>
  );
}
