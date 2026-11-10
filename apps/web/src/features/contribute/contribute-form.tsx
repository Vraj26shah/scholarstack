import {
  CONTRIBUTION_KINDS,
  type ContributionKind,
  type ContributionStatusDto,
  contributorDisplayName,
} from '@ss/contracts';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { friendly } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Button } from '../../shared/ui/button';
import { Check } from '../../shared/ui/icons';
import { U } from '../../shared/ui/note';
import { FilePicker } from './file-picker';
import { KIND_LABEL, fileIssues, problemsWith } from './rules';
import { useSubmitContribution } from './use-contributions';
import { ZipCheck } from './zip-check';

const field =
  'h-11 w-full min-w-0 rounded-xl bg-surface border-[1.5px] border-line px-3 text-[15px] text-ink outline-none focus:border-teal';

/** The share form. Only rendered when the student is allowed to send right now. */
export function ContributeForm({ status }: { status: ContributionStatusDto }) {
  const { me, setMe } = useSession();
  const [title, setTitle] = useState('');
  const [contributorName, setContributorName] = useState(() =>
    me ? contributorDisplayName(me.fullName, me.email) : '',
  );
  const [courseHint, setCourseHint] = useState('');
  const [kind, setKind] = useState<ContributionKind>('notes');
  const [description, setDescription] = useState('');
  const [ownWork, setOwnWork] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [zipProblems, setZipProblems] = useState<string[] | null>([]);
  const [tried, setTried] = useState(false);
  const submit = useSubmitContribution();
  useEffect(() => {
    if (me) setContributorName((current) => current || contributorDisplayName(me.fullName, me.email));
  }, [me]);
  const problems = problemsWith(files, status.limits);
  const issues = fileIssues(files, status.limits);
  const missing = [
    contributorName.trim().length < 2 && 'Add the name you want shown beside your contribution.',
    title.trim().length < 3 && 'Give it a title (at least 3 letters).',
    files.length === 0 && 'Add at least one file.',
    !ownWork && 'Confirm these are yours to share.',
  ].filter(Boolean) as string[];
  const busy = submit.isPending;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missing.length || problems.length || zipProblems === null || zipProblems.length > 0) return;
    submit.mutate(
      {
        meta: {
          title,
          contributorName: contributorName.trim(),
          courseHint,
          kind,
          description,
          ownWork: true,
        },
        files,
      },
      {
        onSuccess: () => {
          if (me) setMe({ ...me, fullName: contributorName.trim() });
          setTitle('');
          setCourseHint('');
          setDescription('');
          setFiles([]);
          setZipProblems([]);
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
          Name shown with your contribution
          <input
            className={field}
            value={contributorName}
            maxLength={80}
            onChange={(e) => setContributorName(e.target.value)}
            placeholder="Your name"
            disabled={busy}
            autoComplete="name"
          />
          <span className="text-xs font-normal text-ink2">
            Shown beside your accepted files, folders or course once they are added. Your email stays private.
          </span>
        </label>
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
        issues={issues}
        totalLimit={status.limits.bytesPerSubmission}
        hint={`PDF, Word, PowerPoint, text, image or ZIP · up to ${status.limits.filesPerSubmission} files · ${status.limits.bytesPerFile / (1024 * 1024)} MB per file · ${status.limits.bytesPerSubmission / (1024 * 1024)} MB total`}
      />
      <ZipCheck files={files} onScanState={setZipProblems} />

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

      {((tried && missing.length > 0) || problems.length > 0 || (zipProblems?.length ?? 0) > 0) && (
        <section
          aria-label="Files to fix"
          className="rounded-2xl border border-blush-text/20 bg-blush/40 p-4 sm:p-5"
          role="alert"
        >
          <h3 className="m-0 text-[15px] font-semibold text-blush-text">A few things to fix</h3>
          <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] text-blush-text">
            {[...(tried ? missing : []), ...problems, ...(zipProblems ?? [])].map((p) => (
              <li key={p} className="break-words">
                {p}
              </li>
            ))}
          </ul>
        </section>
      )}
      {tried && zipProblems === null && (
        <p className="m-0 text-sm text-ink2" role="status">
          Checking ZIP contents and folder names…
        </p>
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
            {submit.progress < 1 ? `Uploading · ${Math.round(submit.progress * 100)}%` : 'Checking files…'}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="brand" size="lg" disabled={busy || zipProblems === null}>
          {busy ? 'Sending…' : zipProblems === null ? 'Checking ZIPs…' : 'Send for review'}
        </Button>
        <span className="text-[13px] text-ink2 inline-flex items-center gap-1.5">
          <Check size={14} className="text-teal-text" />
          {status.todayLeft} of {status.limits.submissionsPerDay} left today
        </span>
      </div>
    </form>
  );
}
