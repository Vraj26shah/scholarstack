import {
  type AdminContributionDto,
  type ContributionReviewInput,
  DEFAULT_ROYALTY_PERCENT,
} from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Field, input } from './ui';

type RewardKind = ContributionReviewInput['reward']['type'];

const REWARDS: [RewardKind, string][] = [
  ['none', 'No reward'],
  ['thanks', 'Thank-you only'],
  ['course', 'Free course'],
  ['cash', 'Cash'],
  ['royalty', `Royalty (${DEFAULT_ROYALTY_PERCENT}% of sales)`],
];

export const CONTRIBUTIONS_KEY = ['admin', 'contributions'] as const;

/** Approve or reject one contribution, with an optional reward and a note for the student. */
export function ReviewForm({ c, onDone }: { c: AdminContributionDto; onDone: () => void }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState<'approved' | 'rejected'>(
    c.status === 'rejected' ? 'rejected' : 'approved',
  );
  const [note, setNote] = useState(c.reviewNote);
  const [kind, setKind] = useState<RewardKind>(c.reward?.type ?? 'none');
  const [courseId, setCourseId] = useState(
    c.reward?.type === 'course' || c.reward?.type === 'royalty' ? c.reward.courseId : '',
  );
  const [share, setShare] = useState(
    String(c.reward?.type === 'royalty' ? c.reward.sharePercent : DEFAULT_ROYALTY_PERCENT),
  );
  const [rupees, setRupees] = useState(c.reward?.type === 'cash' ? String(c.reward.amountRupees) : '');
  const [notify, setNotify] = useState(true);
  const courses = useQuery({
    queryKey: ['admin', 'courses'],
    queryFn: api.adminCourses,
    enabled: kind === 'course' || kind === 'royalty',
  });

  const save = useMutation({
    mutationFn: () => {
      const reward: ContributionReviewInput['reward'] =
        decision === 'rejected' || kind === 'none'
          ? { type: 'none' }
          : kind === 'thanks'
            ? { type: 'thanks' }
            : kind === 'course'
              ? { type: 'course', courseId }
              : kind === 'royalty'
                ? { type: 'royalty', courseId, sharePercent: Number(share) }
                : { type: 'cash', amountRupees: Math.round(Number(rupees)) };
      return api.adminReviewContribution(c.id, { decision, note, reward, notify });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONTRIBUTIONS_KEY });
      onDone();
    },
  });

  const invalid =
    decision === 'approved' &&
    (((kind === 'course' || kind === 'royalty') && !courseId) ||
      (kind === 'cash' && !(Number(rupees) >= 1)) ||
      (kind === 'royalty' && !(Number(share) >= 1 && Number(share) <= 90)));

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-sunk p-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Decision">
        {(['approved', 'rejected'] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={decision === d}
            onClick={() => setDecision(d)}
            className={`h-10 rounded-full px-4 text-sm font-semibold border ${
              decision === d
                ? d === 'approved'
                  ? 'bg-teal text-white border-teal'
                  : 'bg-ink text-bg border-ink'
                : 'border-line text-ink2 bg-surface'
            }`}
          >
            {d === 'approved' ? 'Accept' : 'Reject'}
          </button>
        ))}
      </div>

      {decision === 'approved' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Reward">
            {REWARDS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={kind === k}
                onClick={() => setKind(k)}
                className={`h-9 rounded-full px-3.5 text-[13px] font-semibold border ${
                  kind === k ? 'bg-brand text-white border-brand' : 'border-line text-ink2 bg-surface'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {(kind === 'course' || kind === 'royalty') && (
            <Field label={kind === 'course' ? 'Course to give, free' : 'Course built from these notes'}>
              <select className={input} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                <option value="">{courses.isLoading ? 'Loading courses…' : 'Choose a course'}</option>
                {(courses.data ?? [])
                  .filter((x) => (kind === 'course' ? x.status === 'live' : x.status !== 'archived'))
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {kind === 'royalty' && (
            <>
              <Field label="Their share of each sale (%)">
                <input
                  className={input}
                  inputMode="numeric"
                  value={share}
                  onChange={(e) => setShare(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
              </Field>
              <p className="m-0 text-[13px] text-ink2">
                For a whole subject's notes. Every sale of this course from today counts; the student sees
                what they've earned on their Contribute page. Pay them from Earnings &amp; royalties.
              </p>
            </>
          )}
          {kind === 'cash' && (
            <Field label="Amount (₹), paid by you outside the site">
              <input
                className={input}
                inputMode="numeric"
                value={rupees}
                onChange={(e) => setRupees(e.target.value.replace(/\D/g, ''))}
                placeholder="200"
              />
            </Field>
          )}
          {kind === 'cash' && (
            <p className="m-0 text-[13px] text-ink2">
              The site records the amount and tells the student you'll be in touch. Pay them by UPI yourself,
              then reply to their email.
            </p>
          )}
        </div>
      )}

      <Field
        label={decision === 'rejected' ? 'Reason (the student sees this)' : 'Note to the student (optional)'}
      >
        <textarea
          className={`${input} h-20 py-2 resize-y`}
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
          placeholder={decision === 'rejected' ? 'These look copied from the textbook.' : 'Lovely diagrams!'}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink2">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="size-4 accent-teal"
        />
        Email {c.contributor.email} about this
      </label>
      {save.isError && <p className="m-0 text-sm text-blush-text">{friendly(save.error)}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending || invalid}>
          {save.isPending ? 'Saving…' : decision === 'approved' ? 'Accept' : 'Reject'}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Copy an accepted contribution's files into an R2 course folder, ready for R2 → Website. */
export function CopyToFolder({ c }: { c: AdminContributionDto }) {
  const [folder, setFolder] = useState('');
  const copy = useMutation({ mutationFn: () => api.adminCopyContribution(c.id, folder) });
  return (
    <div className="flex flex-col gap-2">
      <Field label="Add these files to an R2 folder">
        <div className="flex flex-wrap gap-2">
          <input
            className={`${input} flex-1 min-w-[220px] font-mono text-[13px]`}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="drive-imports/24 Batch/DBMS/Unit 2/"
          />
          <Button
            variant="outline"
            onClick={() => copy.mutate()}
            disabled={copy.isPending || folder.trim().length < 3}
          >
            {copy.isPending ? 'Copying…' : 'Copy'}
          </Button>
        </div>
      </Field>
      {copy.isSuccess && (
        <p className="m-0 text-[13px] text-teal-text">
          Copied {copy.data.copied.length} file{copy.data.copied.length === 1 ? '' : 's'}. Now open{' '}
          <strong>R2 → Website</strong>, pick that folder and make its pages.
        </p>
      )}
      {copy.isError && <p className="m-0 text-[13px] text-blush-text">{friendly(copy.error)}</p>}
    </div>
  );
}
