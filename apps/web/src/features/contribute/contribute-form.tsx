import { CONTRIBUTION_KINDS, type ContributionKind, type ContributionStatusDto } from '@ss/contracts';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Check } from '../../shared/ui/icons';
import { U } from '../../shared/ui/note';
import { FilePicker } from './file-picker';
import { KIND_LABEL, problemsWith } from './rules';
import { useSubmitContribution } from './use-contributions';

const field =
  'h-11 w-full min-w-0 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[15px] text-ink outline-none focus:border-teal';

/** The share form. Only rendered when the student is allowed to send right now. */
export function ContributeForm({ status }: { status: ContributionStatusDto }) {
  const [title, setTitle] = useState('');
  const [courseHint, setCourseHint] = useState('');
  const [kind, setKind] = useState<ContributionKind>('notes');
  const [description, setDescription] = useState('');
  const [ownWork, setOwnWork] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const submit = useSubmitContribution();
  const problems = problemsWith(files, status.limits);
  const missing = [
    title.trim().length < 3 && 'Give it a title (at least 3 letters).',
    files.length === 0 && 'Add at least one file.',
    !ownWork && 'Confirm these are yours to share.',
  ].filter(Boolean) as string[];
  const busy = submit.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missing.length || problems.length) return;
    submit.mutate(
      { meta: { title, courseHint, kind, description, ownWork: true }, files },
      {
        onSuccess: () => {
          setTitle('');
          setCourseHint('');
          setDescription('');
          setFiles([]);
          setOwnWork(false);
          setTried(false);
        },
      },
    );
  };

  if (submit.isSuccess && !busy)
    return (
      <div className="flex flex-col items-start gap-4" role="status">
        <p className="m-0 text-[17px] leading-relaxed">
          Thank you. “{submit.data.title}” is <U>in the review pile</U>; we'll email you when it's reviewed.
        </p>
        <Button variant="outline" onClick={() => submit.reset()}>
          Upload something else
        </Button>
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2 min-w-0 sm:col-span-2">
          Title
          <input
            className={field}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="DBMS Unit 2: normalisation, handwritten"
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2 min-w-0">
          Course (code or name)
          <input
            className={field}
            value={courseHint}
            maxLength={120}
            onChange={(e) => setCourseHint(e.target.value)}
            placeholder="CSE3001 · DBMS"
            disabled={busy}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2 min-w-0">
          What is it?
          <select
            className={field}
            value={kind}
            onChange={(e) => setKind(e.target.value as ContributionKind)}
            disabled={busy}
          >
            {CONTRIBUTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink2 min-w-0 sm:col-span-2">
          <span>
            Anything we should know? <span className="font-normal">(optional)</span>
          </span>
          <textarea
            className={`${field} h-24 py-2.5 resize-y`}
            value={description}
            maxLength={1000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Which faculty, which semester, what's covered…"
            disabled={busy}
          />
        </label>
      </div>

      <FilePicker
        files={files}
        onChange={setFiles}
        disabled={busy}
        maxFiles={status.limits.filesPerSubmission}
      />

      <label className="flex items-start gap-3 text-[14px] leading-relaxed cursor-pointer">
        <input
          type="checkbox"
          checked={ownWork}
          onChange={(e) => setOwnWork(e.target.checked)}
          disabled={busy}
          className="mt-1 size-4 flex-none accent-teal"
        />
        <span>
          These are <U>my own notes</U> (or I have permission), with no textbook scans or personal details. I
          agree to the{' '}
          <Link to="/terms#contributors" className="font-semibold text-teal-text">
            contributor terms
          </Link>
          .
        </span>
      </label>

      {tried && (missing.length > 0 || problems.length > 0) && (
        <ul className="m-0 pl-5 list-disc text-[14px] text-blush-text flex flex-col gap-1" role="alert">
          {[...missing, ...problems].map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {submit.isError && (
        <p className="m-0 text-[14px] text-blush-text" role="alert">
          {friendly(submit.error)}
        </p>
      )}

      {busy && (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="h-2 rounded-full bg-sunk overflow-hidden">
            <div
              className="h-full bg-teal transition-[width] duration-200"
              style={{ width: `${Math.round(submit.progress * 100)}%` }}
            />
          </div>
          <span className="font-mono text-[12px] text-ink2">
            {submit.progress < 1 ? `UPLOADING · ${Math.round(submit.progress * 100)}%` : 'CHECKING FILES…'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="brand" size="lg" disabled={busy}>
          {busy ? 'Sending…' : 'Send for review'}
        </Button>
        <span className="text-[13px] text-ink2 inline-flex items-center gap-1.5">
          <Check size={14} className="text-teal-text" />
          {status.todayLeft} of {status.limits.submissionsPerDay} left today
        </span>
      </div>
    </form>
  );
}
