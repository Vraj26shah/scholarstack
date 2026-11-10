import type { UnusedGroupKey } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { bytes } from './storage-map-panel';
import { U, plural } from './ui';

type Where = 'R2' | 'Database' | 'R2 + Database';
const GROUPS: Record<UnusedGroupKey, { title: string; what: string; after: string; where: Where }> = {
  'courses-off-sale': {
    title: 'Courses not on sale',
    what: 'Draft and archived courses: their records, notes and pages.',
    after: 'Courses students bought are always kept. Live courses are never touched.',
    where: 'R2 + Database',
  },
  'missing-files': {
    title: 'Files whose note is gone',
    what: 'File records pointing at a note no longer in storage.',
    after: 'Their records and pages go; the course stays.',
    where: 'R2 + Database',
  },
  pages: {
    title: 'Pages of deleted files',
    what: 'Reader pages made for files that no longer exist.',
    after: 'Pages of current files stay.',
    where: 'R2',
  },
  leftovers: {
    title: 'Unused files in course folders',
    what: 'Old copies and files no course uses.',
    after: 'Files used by courses are kept.',
    where: 'R2',
  },
  'uploads-orphan': {
    title: 'Uploads with no record',
    what: 'Student uploads whose record was deleted.',
    after: 'Uploads that still have a record stay.',
    where: 'R2',
  },
  'uploads-finished': {
    title: 'Originals of filed uploads',
    what: 'Student originals already copied into courses.',
    after: 'Course copies stay.',
    where: 'R2',
  },
  'support-orphan': {
    title: 'Help-desk files with no question',
    what: 'Screenshots from deleted questions.',
    after: 'Attachments of current questions stay.',
    where: 'R2',
  },
};
const ORDER = Object.keys(GROUPS) as UnusedGroupKey[];
const isRecord = (k: UnusedGroupKey) => k === 'courses-off-sale' || k === 'missing-files';

export function WhereTag({ where }: { where: Where }) {
  return (
    <span className="rounded-full bg-sunk px-2 py-0.5 text-[11px] font-semibold text-ink2 whitespace-nowrap">
      {where}
    </span>
  );
}

type CleanUnusedRequest = { group: UnusedGroupKey; key?: string; prefix?: string };

export const cleanedText = (r: { removedObjects: number; removedBytes: number; removedRows: number }) =>
  [
    r.removedObjects
      ? `${plural(r.removedObjects, 'object')}${r.removedBytes ? ` (${bytes(r.removedBytes)})` : ''}`
      : '',
    r.removedRows ? plural(r.removedRows, 'database record') : '',
  ]
    .filter(Boolean)
    .join(' and ') || 'nothing';

/** Everything stored that nothing uses (R2 and the database), by kind, each with a safe delete. */
export function UnusedSection({ onCleaned }: { onCleaned: (text: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'storage-unused'],
    queryFn: api.adminStorageUnused,
    staleTime: 5 * 60_000,
  });
  const [open, setOpen] = useState<UnusedGroupKey | null>(null);
  const [asking, setAsking] = useState<UnusedGroupKey | null>(null);
  const [itemAsking, setItemAsking] = useState<{
    group: UnusedGroupKey;
    key: string;
    label: string;
    bytes: number;
  } | null>(null);
  const [scope, setScope] = useState('');
  const clean = useMutation({
    mutationFn: ({ group, key, prefix }: CleanUnusedRequest) =>
      key
        ? api.adminStorageClean({ what: 'unused-object', group, key })
        : group === 'pages'
          ? api.adminStorageClean({ what: 'pages' })
          : api.adminStorageClean({ what: 'unused', group, ...(prefix ? { prefix } : {}) }),
    onSuccess: (r) => {
      setAsking(null);
      setItemAsking(null);
      onCleaned(`Removed ${cleanedText(r)}.`);
      for (const key of [
        ['admin', 'storage-unused'],
        ['admin', 'storage-map'],
        ['admin', 'storage-tree'],
        ['admin-courses'],
      ])
        void qc.invalidateQueries({ queryKey: key });
    },
  });
  const scoped = (k: UnusedGroupKey) => k !== 'pages' && !isRecord(k);
  // Folders (down to course level) with unused files, to clear one place at a time.
  const folders = [
    ...new Set(
      (q.data?.groups ?? [])
        .filter((g) => scoped(g.key))
        .flatMap((g) => g.items.map((i) => `${i.key.split('/').slice(0, 3).join('/')}/`)),
    ),
  ].sort();
  const groups = (q.data?.groups ?? [])
    .filter((g) => !scope || scoped(g.key))
    .map((g) => {
      if (!scope) return g;
      const items = g.items.filter((i) => i.key.startsWith(scope));
      return { ...g, items, objects: items.length, bytes: items.reduce((t, i) => t + i.bytes, 0) };
    })
    .filter((g) => g.objects > 0)
    .sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  const total = groups.reduce((t, g) => t + g.bytes, 0);
  const rows = groups.reduce((t, g) => t + (g.rows ?? 0), 0);
  const g = asking ? groups.find((x) => x.key === asking) : null;
  const unit = (k: UnusedGroupKey) =>
    k === 'pages'
      ? 'folder'
      : k === 'courses-off-sale'
        ? 'course'
        : k === 'missing-files'
          ? 'record'
          : 'file';
  return (
    <section className="flex flex-col gap-3" aria-labelledby="unused-title">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex flex-col gap-0.5 mr-auto">
          <h3 id="unused-title" className="m-0 text-lg font-semibold">
            Can be deleted
          </h3>
          {q.data && (
            <span className="text-[13px] text-ink2">
              {groups.length ? (
                <>
                  <U>
                    {bytes(total)}
                    {rows ? ` and ${plural(rows, 'record')}` : ''}
                  </U>{' '}
                  · checked again before anything goes
                </>
              ) : (
                'Nothing to delete'
              )}{' '}
              · scanned{' '}
              {new Date(q.data.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        {folders.length > 1 && (
          <select
            aria-label="Only in folder"
            className="h-10 px-3 rounded-xl bg-surface border-[1.5px] border-line text-[14px] max-w-full"
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="">Everywhere</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </div>
      {q.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {q.data && groups.length === 0 && (
        <p className="m-0 rounded-xl bg-mist/40 px-4 py-3 text-[15px]">
          All clean: everything stored is in use.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-2">
        {groups.map((x) => (
          <li
            key={x.key}
            className="rounded-xl bg-card p-3.5 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <WhereTag where={GROUPS[x.key].where} />
              <span className="font-semibold">{GROUPS[x.key].title}</span>
              <span className="font-mono text-[12px] text-ink2">
                {plural(x.objects, unit(x.key))}
                {x.bytes ? ` · ${bytes(x.bytes)}` : ''}
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
                Delete all
              </Button>
            </div>
            <p className="m-0 text-[13px] text-ink2">{GROUPS[x.key].what}</p>
            {open === x.key && (
              <ul className="m-0 p-0 list-none max-h-72 overflow-y-auto text-[13px] flex flex-col">
                {x.items.map((i) => (
                  <li
                    key={i.key}
                    className="flex items-center justify-between gap-3 border-t border-line/60 py-1.5"
                  >
                    <span className="min-w-0 flex flex-col">
                      <span
                        className={i.label ? 'font-medium break-words' : 'font-mono text-[12px] break-all'}
                      >
                        {i.label ?? i.key}
                      </span>
                      {i.note && <span className="text-[12px] text-ink2">{i.note}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-ink2 font-mono text-[12px]">
                      {i.bytes ? bytes(i.bytes) : ''}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Delete ${i.label ?? i.key}`}
                        onClick={() =>
                          setItemAsking({ group: x.key, key: i.key, label: i.label ?? i.key, bytes: i.bytes })
                        }
                      >
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {q.data && q.data.notImported.length > 0 && (
        <details className="rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold text-ink2">
            Kept: {plural(q.data.notImported.length, 'folder')} not in a course yet
          </summary>
          <ul className="m-0 mt-2 p-0 list-none flex flex-col gap-0.5 font-mono text-[12px]">
            {q.data.notImported.map((f) => (
              <li key={f.folder} className="flex justify-between gap-3">
                <a
                  className="break-all text-teal-text"
                  href={`/admin?section=folders&folder=${encodeURIComponent(f.folder)}`}
                >
                  {f.folder}
                </a>
                <span className="whitespace-nowrap text-ink2">
                  {plural(f.objects, 'file')} · {bytes(f.bytes)}
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-2 text-[13px] text-ink2">Open one to make it a course, or delete it there.</p>
        </details>
      )}
      {g && asking && (
        <Sheet
          open
          onOpenChange={(o) => !o && setAsking(null)}
          title={`Delete ${GROUPS[asking].title.toLowerCase()}?`}
        >
          <p className="m-0 text-[15px]">
            {plural(g.objects, unit(g.key))}
            {g.bytes ? `, ${bytes(g.bytes)}` : ''}
            {scope ? ` in ${scope}` : ''}. {GROUPS[asking].after}
          </p>
          {clean.isError && <p className="m-0 text-sm text-blush-text">{friendly(clean.error)}</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="ink"
              onClick={() => clean.mutate({ group: asking, prefix: scope || undefined })}
              disabled={clean.isPending}
            >
              {clean.isPending ? 'Deleting…' : 'Delete all'}
            </Button>
            <Button variant="outline" onClick={() => setAsking(null)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      )}
      {itemAsking && (
        <Sheet
          open
          onOpenChange={(o) => !o && setItemAsking(null)}
          title={`Delete this ${unit(itemAsking.group)}?`}
        >
          <p className="m-0 text-[14px] font-semibold break-all">{itemAsking.label}</p>
          <p className="m-0 text-[14px] text-ink2">
            {itemAsking.bytes ? `${bytes(itemAsking.bytes)}. ` : ''}
            {GROUPS[itemAsking.group].after}
          </p>
          {clean.isError && <p className="m-0 text-sm text-blush-text">{friendly(clean.error)}</p>}
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="ink"
              onClick={() => clean.mutate({ group: itemAsking.group, key: itemAsking.key })}
              disabled={clean.isPending}
            >
              {clean.isPending ? 'Deleting…' : 'Delete'}
            </Button>
            <Button variant="outline" onClick={() => setItemAsking(null)}>
              Cancel
            </Button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
