import type { SupportMessageDto } from '@ss/contracts';
import { when } from './topics';

/** A conversation as letters on a ruled card: the student's on the left, the library's on the right. */
export function Thread({
  messages,
  me = 'student',
}: { messages: SupportMessageDto[]; me?: 'student' | 'admin' }) {
  return (
    <ol className="m-0 p-0 list-none flex flex-col gap-3">
      {messages.map((m) => {
        const mine = me === 'admin' ? m.fromAdmin : !m.fromAdmin;
        return (
          <li key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[min(560px,92%)] rounded-2xl px-4 py-3 flex flex-col gap-1.5 ${
                m.fromAdmin ? 'bg-brand text-white rounded-br-md' : 'bg-sunk text-ink rounded-bl-md'
              } ${mine ? '' : ''}`}
            >
              <span className={`font-mono text-[11px] ${m.fromAdmin ? 'text-on-brand2' : 'text-ink2'}`}>
                {m.author.toUpperCase()} · {when(m.createdAt)}
              </span>
              <p className="m-0 text-[15px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {m.body}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
