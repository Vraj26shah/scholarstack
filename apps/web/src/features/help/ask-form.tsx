import { type MySupportDto, SUPPORT_TOPICS, type SupportTopic } from '@ss/contracts';
import { type FormEvent, useState } from 'react';
import { friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { U } from '../../shared/ui/note';
import { FilePicker } from '../contribute/file-picker';
import { formatBytes } from '../contribute/rules';
import { TOPICS } from './topics';
import { useAsk } from './use-support';

const field =
  'h-11 w-full min-w-0 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[15px] text-ink outline-none focus:border-teal';
const IMAGE_TYPES = ['png', 'jpg', 'jpeg', 'pdf'];

/** Ask a question or report what's wrong. Screenshots are optional but welcome. */
export function AskForm({
  status,
  initialTopic,
  page,
}: { status: MySupportDto; initialTopic: SupportTopic; page: string }) {
  const [topic, setTopic] = useState<SupportTopic>(initialTopic);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const ask = useAsk();
  const L = status.limits;
  const fileProblems = [
    files.length > L.filesPerQuery && `Attach up to ${L.filesPerQuery} files.`,
    ...files.map((f) =>
      !IMAGE_TYPES.includes(f.name.split('.').pop()?.toLowerCase() ?? '')
        ? `${f.name}: only screenshots (PNG, JPG) or a PDF.`
        : f.size > L.bytesPerFile
          ? `${f.name} is ${formatBytes(f.size)}; the limit is ${L.bytesPerFile / 1024 / 1024} MB.`
          : null,
    ),
  ].filter(Boolean) as string[];
  const missing = [
    subject.trim().length < 3 && 'Add a short subject.',
    message.trim().length < 5 && 'Tell us a little more.',
  ].filter(Boolean) as string[];

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missing.length || fileProblems.length) return;
    ask.mutate(
      { input: { topic, subject, message, page }, files },
      {
        onSuccess: () => {
          setSubject('');
          setMessage('');
          setFiles([]);
          setTried(false);
        },
      },
    );
  };

  if (ask.isSuccess && !ask.isPending)
    return (
      <div className="flex flex-col items-start gap-4" role="status">
        <p className="m-0 text-[17px] leading-relaxed">
          Got it. <U>We'll email you</U> when we answer “{ask.data.subject}”.
        </p>
        <Button variant="outline" onClick={() => ask.reset()}>
          Send another
        </Button>
      </div>
    );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <fieldset className="m-0 p-0 border-0 flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-ink2">What's it about?</legend>
        <div className="flex flex-wrap gap-2">
          {SUPPORT_TOPICS.map((t) => (
            <label
              key={t}
              className={`h-10 inline-flex items-center rounded-full border-[1.5px] px-4 text-[14px] font-semibold cursor-pointer transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal ${
                topic === t ? 'border-brand bg-brand text-white' : 'border-line text-ink hover:border-ink2'
              }`}
            >
              <input
                type="radio"
                name="topic"
                value={t}
                checked={topic === t}
                onChange={() => setTopic(t)}
                className="sr-only"
              />
              {TOPICS[t].label}
            </label>
          ))}
        </div>
        <p className="m-0 text-[13px] text-ink2">{TOPICS[topic].hint}</p>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2">
        Subject
        <input
          className={field}
          value={subject}
          maxLength={140}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={
            topic === 'suggestion'
              ? 'A dark mode for reading at night'
              : "Paid for DBMS but it isn't on my shelf"
          }
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2">
        {topic === 'suggestion' ? 'Your idea' : 'What happened?'}
        <textarea
          className={`${field} h-32 py-2.5 resize-y`}
          value={message}
          maxLength={4000}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            topic === 'suggestion'
              ? 'What would make Scholars Stack better for you?'
              : 'What you did, and what you saw instead.'
          }
        />
      </label>
      {page && <p className="m-0 font-mono text-[12px] text-ink2 break-all">FROM PAGE · {page}</p>}
      <FilePicker
        files={files}
        onChange={setFiles}
        maxFiles={L.filesPerQuery}
        accept=".png,.jpg,.jpeg,.pdf"
        prompt={topic === 'suggestion' ? 'Add a picture (optional)' : "Add a screenshot of what's wrong"}
        hint={`PNG, JPG or PDF · up to ${L.filesPerQuery} files, ${L.bytesPerFile / 1024 / 1024} MB each · optional`}
        disabled={ask.isPending}
      />
      {tried && (missing.length > 0 || fileProblems.length > 0) && (
        <ul className="m-0 pl-5 list-disc text-[14px] text-blush-text flex flex-col gap-1" role="alert">
          {[...missing, ...fileProblems].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {ask.isError && (
        <p className="m-0 text-[14px] text-blush-text" role="alert">
          {friendly(ask.error)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={ask.isPending}>
          {ask.isPending ? 'Sending…' : topic === 'suggestion' ? 'Send suggestion' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
