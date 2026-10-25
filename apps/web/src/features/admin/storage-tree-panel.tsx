import type { StorageDeletePreviewDto, StorageTreeDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { ChevronRight } from '../../shared/ui/icons';
import { MoveFolderCard, bytes } from './storage-map-panel';
import { type TreeNode, buildTree } from './storage-tree';
import { Panel, StatusPill, U, input, plural } from './ui';

const KEY = ['admin', 'storage-tree'] as const;
type Show = 'all' | 'unused' | 'missing';

const STATE = {
  used: { label: 'in use', tone: 'text-teal-text' },
  unused: { label: 'unused', tone: 'text-marigold-text' },
  missing: { label: 'gone from R2', tone: 'text-blush-text' },
} as const;

/** Shows exactly what goes, then asks for DELETE. */
function DeleteSheet({ path, onClose }: { path: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const preview = useQuery({
    queryKey: ['admin', 'storage-preview', path],
    queryFn: () => api.adminStoragePreview(path),
  });
  const del = useMutation({
    mutationFn: () => api.adminStorageDelete(path),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['admin', 'courses'] });
      void qc.invalidateQueries({ queryKey: ['admin-overview'] });
    },
  });
  const p: StorageDeletePreviewDto | undefined = preview.data;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={del.isSuccess ? 'Deleted' : 'Delete completely?'}
    >
      <p className="m-0 font-mono text-[12px] text-ink2 break-all">{path}</p>
      {preview.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {preview.isError && <p className="m-0 text-sm text-blush-text">{friendly(preview.error)}</p>}
      {del.isSuccess ? (
        <>
          <p className="m-0 text-[15px]">
            Removed <U>{plural(del.data.removedObjects, 'file')}</U> ({bytes(del.data.removedBytes)}) from R2,{' '}
            {plural(del.data.removedPageObjects, 'page')} and {plural(del.data.removedFiles, 'record')} from
            Supabase.
            {del.data.deletedCourses ? ` ${plural(del.data.deletedCourses, 'course')} deleted.` : ''}
            {del.data.archivedCourses
              ? ` ${plural(del.data.archivedCourses, 'sold course')} archived (sales kept).`
              : ''}
          </p>
          <Button onClick={onClose}>Done</Button>
        </>
      ) : (
        p && (
          <>
            <p className="m-0 text-[15px] leading-relaxed">
              This removes{' '}
              <U>
                {plural(p.r2Objects, 'file')} ({bytes(p.r2Bytes)})
              </U>{' '}
              from R2,{' '}
              <U>
                {plural(p.pageObjects, 'page')} ({bytes(p.pageBytes)})
              </U>{' '}
              and <U>{plural(p.files, 'record')}</U> from Supabase.
            </p>
            {p.courses.map((c) => (
              <p key={c.id} className="m-0 text-[14px] text-ink2">
                <strong className="text-ink">{c.title}</strong> ({c.status}
                {c.students ? `, ${plural(c.students, 'student')} reading` : ''}):{' '}
                {c.whole
                  ? c.students
                    ? 'the whole course goes; it is archived to keep its sales history.'
                    : 'the whole course is deleted.'
                  : 'some of its files go; the rest stay.'}
              </p>
            ))}
            {p.blocked ? (
              <p className="m-0 text-[14px] font-semibold text-blush-text">{p.blocked}</p>
            ) : (
              <>
                <label className="flex flex-col gap-1.5 text-sm font-semibold">
                  Type DELETE to confirm
                  <input
                    className={input}
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoComplete="off"
                  />
                </label>
                {del.isError && <p className="m-0 text-sm text-blush-text">{friendly(del.error)}</p>}
                <div className="flex flex-wrap gap-2.5">
                  <Button
                    variant="ink"
                    disabled={typed !== 'DELETE' || del.isPending}
                    onClick={() => del.mutate()}
                  >
                    {del.isPending ? 'Deleting…' : 'Delete for good'}
                  </Button>
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </>
        )
      )}
    </Sheet>
  );
}

function Row({
  n,
  depth,
  open,
  toggle,
  onDelete,
}: {
  n: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const expanded = open.has(n.path);
  const state = n.entry ? STATE[n.entry.state] : null;
  return (
    <li>
      <div
        className="group flex items-center gap-2 min-h-11 pr-2 rounded-lg hover:bg-sunk"
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {n.isFolder ? (
          <button
            type="button"
            onClick={() => toggle(n.path)}
            aria-expanded={expanded}
            className="flex flex-1 min-w-0 items-center gap-2 text-left"
          >
            <ChevronRight
              size={16}
              className={`flex-none text-ink2 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            <span className="font-semibold text-[14.5px] truncate">{n.name}/</span>
            {n.course && <StatusPill status={n.course.status} />}
            {n.course && (
              <span className="hidden sm:inline text-[13px] text-ink2 truncate">{n.course.title}</span>
            )}
          </button>
        ) : (
          <span className="flex flex-1 min-w-0 items-center gap-2 pl-6">
            <span
              className={`text-[14px] truncate ${n.entry?.state === 'missing' ? 'line-through text-ink2' : ''}`}
              title={n.name}
            >
              {n.name}
            </span>
            {state && <span className={`flex-none font-mono text-[11px] ${state.tone}`}>{state.label}</span>}
          </span>
        )}
        <span className="flex-none text-right font-mono text-[12px] text-ink2 tabular-nums">
          {n.isFolder ? `${n.files} · ` : ''}
          {bytes(n.bytes + n.pageBytes)}
          {n.isFolder && (n.unused || n.missing) ? (
            <span className="text-marigold-text">
              {' '}
              · {n.unused ? `${n.unused} unused` : ''}
              {n.unused && n.missing ? ', ' : ''}
              {n.missing ? `${n.missing} gone` : ''}
            </span>
          ) : null}
        </span>
        {n.path.split('/').filter(Boolean).length >= 2 && (
          <button
            type="button"
            onClick={() => onDelete(n.path)}
            aria-label={`Delete ${n.path}`}
            className="flex-none h-8 px-2.5 rounded-full text-[12.5px] font-semibold text-ink2 hover:text-blush-text hover:bg-blush/40 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
          >
            Delete
          </button>
        )}
      </div>
      {n.isFolder && expanded && (
        <ul className="m-0 p-0 list-none">
          {n.children.map((c) => (
            <Row key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every notes file in R2 as folders, with its course; deleting removes it from R2 and Supabase. */
export function StorageTreePanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: KEY, queryFn: api.adminStorageTree, staleTime: 2 * 60_000 });
  const [show, setShow] = useState<Show>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const data: StorageTreeDto | undefined = q.data;
  const tree = useMemo(() => {
    if (!data) return null;
    const s = search.trim().toLowerCase();
    return buildTree(
      data,
      (e) =>
        (show === 'all' || e.state === show) &&
        (!s ||
          e.key.toLowerCase().includes(s) ||
          data.courses
            .find((c) => c.id === e.courseId)
            ?.title.toLowerCase()
            .includes(s) === true),
    );
  }, [data, show, search]);
  // Filters and searches open everything so matches are visible; otherwise the top level is open.
  const allOpen = show !== 'all' || search.trim().length > 0;
  const openSet = useMemo(() => {
    if (!tree) return open;
    if (!allOpen && open.size) return open;
    const out = new Set(open);
    const walk = (n: TreeNode, d: number) => {
      if (n.isFolder && (allOpen || d < 1)) out.add(n.path);
      for (const c of n.children) walk(c, d + 1);
    };
    for (const c of tree.children) walk(c, 0);
    return out;
  }, [tree, open, allOpen]);
  const toggle = (path: string) =>
    setOpen(() => {
      const n = new Set(openSet);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  return (
    <Panel
      title="Files & folders"
      aside={
        <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Scanning R2…' : 'Scan again'}
        </Button>
      }
    >
      {q.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {q.isError && <p className="m-0 text-blush-text">{friendly(q.error)}</p>}
      {data && tree && (
        <>
          <p className="m-0 text-[15px] text-ink2">
            <U>{plural(data.totals.objects, 'file')}</U> of notes ({bytes(data.totals.bytes)}) and{' '}
            {bytes(data.totals.pageBytes)} of reader pages
            {data.totals.unused ? (
              <>
                ; <U>{data.totals.unused} unused</U>
              </>
            ) : null}
            {data.totals.missing ? (
              <>
                ; <U>{data.totals.missing} gone from R2</U> but still in Supabase
              </>
            ) : null}
            .
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {(
              [
                ['all', 'Everything'],
                ['unused', `Unused (${data.totals.unused})`],
                ['missing', `Gone from R2 (${data.totals.missing})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={show === k}
                onClick={() => setShow(k)}
                className={`h-9 rounded-full px-3.5 text-sm font-semibold border ${show === k ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
              >
                {label}
              </button>
            ))}
            <input
              className={`${input} h-9 ml-auto w-full sm:w-72`}
              placeholder="Find a folder, file or course"
              aria-label="Find a folder, file or course"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-2 max-h-[620px] overflow-y-auto">
            {tree.children.length === 0 ? (
              <p className="m-0 p-4 text-ink2">Nothing matches.</p>
            ) : (
              <ul className="m-0 p-0 list-none">
                {tree.children.map((c) => (
                  <Row key={c.path} n={c} depth={0} open={openSet} toggle={toggle} onDelete={setDeleting} />
                ))}
              </ul>
            )}
          </div>
          <MoveFolderCard
            onMoved={() => {
              void qc.invalidateQueries({ queryKey: KEY });
              void qc.invalidateQueries({ queryKey: ['admin', 'courses'] });
            }}
          />
        </>
      )}
      {deleting && <DeleteSheet path={deleting} onClose={() => setDeleting(null)} />}
    </Panel>
  );
}
