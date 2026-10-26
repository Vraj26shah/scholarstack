import type { UnusedGroupKey } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { bytes } from './storage-map-panel';
import { U, plural } from './ui';

const GROUPS: Record<UnusedGroupKey, { title: string; what: string; after: string }> = {
  pages: {
    title: 'Pages of deleted files',
    what: 'Reader pages made for files that no longer exist.',
    after: 'Pages of current files stay.',
  },
  leftovers: {
    title: 'Leftovers in course folders',
    what: 'Files inside a course folder that the site doesn’t use: old copies, system files, types that can’t become pages.',
    after: 'Files the site uses are never touched.',
  },
  'uploads-orphan': {
    title: 'Uploads with no record',
    what: 'Student uploads whose record was deleted.',
    after: 'Uploads that still have a record stay.',
  },
  'uploads-finished': {
    title: 'Originals of finished uploads',
    what: 'Uploads marked done: their files are already copied into courses.',
    after: 'The copies in courses stay; these uploads just can’t be downloaded again.',
  },
  'support-orphan': {
    title: 'Help-desk attachments with no question',
    what: 'Screenshots from questions that were deleted.',
    after: 'Attachments of current questions stay.',
  },
};

/** Everything stored that nothing uses, by kind, each with what it is and a safe delete. */
export function UnusedSection({ onCleaned }: { onCleaned: (text: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'storage-unused'],
    queryFn: api.adminStorageUnused,
    staleTime: 5 * 60_000,
  });
  const [open, setOpen] = useState<UnusedGroupKey | null>(null);
  const [asking, setAsking] = useState<UnusedGroupKey | null>(null);
  const clean = useMutation({
    mutationFn: (key: UnusedGroupKey) =>
      key === 'pages'
        ? api.adminStorageClean({ what: 'pages' })
        : api.adminStorageClean({ what: 'unused', group: key }),
    onSuccess: (r) => {
      setAsking(null);
      onCleaned(
        `Removed ${plural(r.removedObjects, 'object')}${r.removedBytes ? ` (${bytes(r.removedBytes)})` : ''}.`,
      );
      for (const key of [
        ['admin', 'storage-unused'],
        ['admin', 'storage-map'],
        ['admin', 'storage-tree'],
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });
  const groups = (q.data?.groups ?? []).filter((g) => g.objects > 0);
  const total = groups.reduce((t, g) => t + g.bytes, 0);
  const g = asking ? q.data?.groups.find((x) => x.key === asking) : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="unused-title">
      <h3 id="unused-title" className="m-0 text-lg font-semibold">
        Unused storage
      </h3>
      {q.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {q.data && groups.length === 0 && (
        <p className="m-0 text-[15px] text-ink2">Nothing unused: everything stored is in use.</p>
      )}
      {groups.length > 0 && (
        <p className="m-0 text-[15px] text-ink2">
          <U>{bytes(total)}</U> is stored but used by nothing. Each delete checks again first, so anything put
          back in use since this scan is kept.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {groups.map((x) => (
          <li
            key={x.key}
            className="rounded-xl bg-card p-3.5 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold">{GROUPS[x.key].title}</span>
              <span className="font-mono text-[12px] text-ink2">
                {plural(x.objects, x.key === 'pages' ? 'folder' : 'file')} · {bytes(x.bytes)}
              </span>
              <span className="flex-1" />
              <button
                type="button"
                className="text-[13px] font-semibold text-teal-text underline underline-offset-4"
                aria-expanded={open === x.key}
                onClick={() => setOpen(open === x.key ? null : x.key)}
              >
                {open === x.key ? 'Hide' : 'Show'}
              </button>
              <Button size="sm" variant="outline" onClick={() => setAsking(x.key)}>
                Delete
              </Button>
            </div>
            <p className="m-0 text-[13px] text-ink2">{GROUPS[x.key].what}</p>
            {open === x.key && (
              <ul className="m-0 p-0 list-none max-h-48 overflow-y-auto font-mono text-[12px] flex flex-col gap-0.5">
                {x.items.map((i) => (
                  <li key={i.key} className="flex justify-between gap-3">
                    <span className="break-all">{i.key}</span>
                    <span className="whitespace-nowrap text-ink2">{bytes(i.bytes)}</span>
                  </li>
                ))}
                {x.objects > x.items.length && (
                  <li className="text-ink2">…and {x.objects - x.items.length} more</li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {q.data && q.data.notImported.length > 0 && (
        <details className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink2">
            Waiting to be imported ({plural(q.data.notImported.length, 'folder')}): not unused, kept
          </summary>
          <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-0.5 font-mono text-[12px]">
            {q.data.notImported.map((f) => (
              <li key={f.folder} className="flex justify-between gap-3">
                <span className="break-all">{f.folder}</span>
                <span className="whitespace-nowrap text-ink2">
                  {plural(f.objects, 'file')} · {bytes(f.bytes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[13px] text-ink2">
            Import them in Courses › Add courses, or delete them in Files.
          </p>
        </details>
      )}
      {g && asking && (
        <Sheet
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={`Delete ${GROUPS[asking].title.toLowerCase()}?`}
        >
          <p className="m-0 text-[15px]">
            {plural(g.objects, g.key === 'pages' ? 'folder' : 'file')}, {bytes(g.bytes)}.{' '}
            {GROUPS[asking].after}
          </p>
          {clean.isError && <p className="m-0 text-sm text-blush-text">{friendly(clean.error)}</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button variant="ink" onClick={() => clean.mutate(asking)} disabled={clean.isPending}>
              {clean.isPending ? 'Deleting…' : 'Delete'}
            </Button>
            <Button variant="outline" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
