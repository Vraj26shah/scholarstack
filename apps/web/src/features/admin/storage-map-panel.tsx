import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import { Panel, U, input, plural } from './ui';

export const bytes = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-1 min-w-0">
      <span className="text-[12px] font-semibold text-ink2">{label}</span>
      <span className="font-display font-extrabold text-[28px] leading-none tracking-[-0.03em]">{value}</span>
      <span className={`text-[13px] ${warn ? 'text-blush-text font-semibold' : 'text-ink2'}`}>{sub}</span>
    </div>
  );
}

/** One confirmation for anything that deletes: say exactly what goes, require typing DELETE. */
export function Confirm({
  open,
  title,
  lines,
  busy,
  onYes,
  onClose,
}: {
  open: boolean;
  title: string;
  lines: string[];
  busy: boolean;
  onYes: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()} title={title}>
      <ul className="m-0 pl-5 text-[14px] text-ink2 flex flex-col gap-1">
        {lines.map((l) => (
          <li key={l} className="[overflow-wrap:anywhere]">
            {l}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[14px] font-semibold text-blush-text">This can’t be undone.</p>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Type DELETE to confirm
        <input
          className={input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
        />
      </label>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="brand" disabled={typed !== 'DELETE' || busy} onClick={onYes}>
          {busy ? 'Deleting…' : 'Delete'}
        </Button>
        <Button variant="outline" onClick={close}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

export function MoveFolderCard({ onMoved }: { onMoved: () => void }) {
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: api.adminCourses });
  const [courseId, setCourseId] = useState('');
  const [folder, setFolder] = useState('');
  const course = courses.data?.find((c) => c.id === courseId);
  const move = useMutation({
    mutationFn: api.adminMoveCourseFolder,
    onSuccess: () => {
      setFolder('');
      onMoved();
    },
  });
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-4 sm:p-5 shadow-[0_0_0_1px_var(--line)]">
      <h3 className="m-0 text-lg font-semibold">Move or rename a course’s folder</h3>
      <p className="m-0 text-sm text-ink2">
        Move folders here, <U>not in the Cloudflare dashboard</U>: pages are kept and students keep their
        place.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-semibold min-w-0">
          Course
          <select
            className={input}
            value={courseId}
            onChange={(e) => {
              setCourseId(e.target.value);
              const c = courses.data?.find((x) => x.id === e.target.value);
              setFolder(c?.r2Prefix ?? '');
              move.reset();
            }}
          >
            <option value="">Choose a course…</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {c.batchYear}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold min-w-0">
          New folder in R2
          <input
            className={input}
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="drive-imports/23 Batch/Database Management Systems/"
            disabled={!course}
          />
        </label>
      </div>
      {course && (
        <p className="m-0 font-mono text-[12px] text-ink2 break-all">
          {course.r2Prefix} → {folder || '…'}
        </p>
      )}
      {move.isError && <p className="m-0 text-sm text-blush-text">{friendly(move.error)}</p>}
      {move.data && (
        <p role="status" className="m-0 text-sm font-semibold text-teal-text break-all">
          Moved {plural(move.data.movedObjects, 'file')} to {move.data.to}
          {move.data.leftovers ? ` (${move.data.leftovers} old copies left; delete them below)` : ''}.
        </p>
      )}
      <Button
        variant="brand"
        className="self-start"
        disabled={!course || !folder.trim() || folder.trim() === course.r2Prefix || move.isPending}
        onClick={() => move.mutate({ courseId, newFolder: folder })}
      >
        {move.isPending ? 'Moving…' : 'Move folder'}
      </Button>
    </section>
  );
}

/** Everything stored in R2 and Supabase, what uses it, and safe clean-up of what nothing uses. */
export function StorageMapPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'storage-map'],
    queryFn: api.adminStorageMap,
    staleTime: 5 * 60_000,
  });
  const [confirm, setConfirm] = useState<null | 'notes' | 'pages' | 'orders'>(null);
  const [done, setDone] = useState<string | null>(null);
  const clean = useMutation({
    mutationFn: api.adminStorageClean,
    onSuccess: (r) => {
      setConfirm(null);
      setDone(
        r.removedRows
          ? `Removed ${plural(r.removedRows, 'abandoned checkout')}.`
          : `Removed ${plural(r.removedObjects, 'file')}${r.removedBytes ? ` (${bytes(r.removedBytes)})` : ''}.`,
      );
      void qc.invalidateQueries({ queryKey: ['admin', 'storage-map'] });
    },
  });
  const m = q.data;
  const dbBytes = (m?.database ?? []).reduce((t, d) => t + d.bytes, 0);

  return (
    <Panel
      title="Clean-up"
      aside={
        <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Scanning R2…' : 'Scan again'}
        </Button>
      }
    >
      {q.isLoading && (
        <p className="m-0 text-ink2">Scanning every object in R2. This takes up to a minute…</p>
      )}
      {q.isError && <p className="m-0 text-blush-text">{friendly(q.error)}</p>}
      {done && (
        <p role="status" className="m-0 text-sm font-semibold text-teal-text">
          {done}
        </p>
      )}
      {clean.isError && <p className="m-0 text-sm text-blush-text">{friendly(clean.error)}</p>}
      {m && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Stat
              label="R2 · uploaded notes"
              value={bytes(m.r2.notes.bytes)}
              sub={
                m.r2.notes.unusedObjects
                  ? `${plural(m.r2.notes.unusedObjects, 'file')} unused · ${bytes(m.r2.notes.unusedBytes)}`
                  : `${plural(m.r2.notes.objects, 'file')}, all in use`
              }
              warn={m.r2.notes.unusedObjects > 0}
            />
            <Stat
              label="R2 · generated pages"
              value={bytes(m.r2.pages.bytes)}
              sub={
                m.r2.pages.unusedObjects
                  ? `${plural(m.unusedPageFolders.length, 'old folder')} unused · ${bytes(m.r2.pages.unusedBytes)}`
                  : `${plural(m.r2.pages.files, 'file')}, all in use`
              }
              warn={m.r2.pages.unusedObjects > 0}
            />
            <Stat
              label="Supabase · database"
              value={bytes(dbBytes)}
              sub={`${plural(m.database.length, 'table')}`}
            />
          </div>

          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-lg font-semibold">Generated pages</h3>
            <p className="m-0 text-sm text-ink2">
              {plural(m.r2.pages.files, 'page folder')} (one per notes file, named pages/&lt;file id&gt;/).{' '}
              {m.unusedPageFolders.length
                ? `${plural(m.unusedPageFolders.length, 'folder')} belong to files that no longer exist.`
                : 'Every folder belongs to a current file.'}
            </p>
            {m.unusedPageFolders.length > 0 && (
              <>
                <ul className="m-0 p-0 list-none flex flex-col gap-1 max-h-48 overflow-y-auto font-mono text-[12px]">
                  {m.unusedPageFolders.slice(0, 50).map((p) => (
                    <li key={p.folder} className="flex justify-between gap-3">
                      <span className="break-all">{p.folder}</span>
                      <span className="whitespace-nowrap text-ink2">
                        {p.objects} · {bytes(p.bytes)}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="self-start" onClick={() => setConfirm('pages')}>
                  Delete unused page folders ({bytes(m.r2.pages.unusedBytes)})
                </Button>
              </>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="m-0 text-lg font-semibold">Supabase tables</h3>
            <div className="overflow-x-auto rounded-2xl shadow-[0_0_0_1px_var(--line)]">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead className="bg-sunk text-left text-[12px] text-ink2">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Table</th>
                    <th className="px-3 py-2 font-semibold">Holds</th>
                    <th className="px-3 py-2 font-semibold text-right">Rows</th>
                    <th className="px-3 py-2 font-semibold text-right">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {m.database.map((d) => (
                    <tr key={d.table} className="border-t border-line bg-card">
                      <td className="px-3 py-2 font-mono text-[12.5px]">{d.table}</td>
                      <td className="px-3 py-2 text-ink2">{d.purpose}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{d.rows.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                        {bytes(d.bytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-sm text-ink2">
              Paid orders, access and accounts are{' '}
              <span className="font-semibold text-ink underline decoration-teal decoration-2 underline-offset-4">
                kept as your sales history
              </span>
              .
            </p>
            {m.abandonedOrders > 0 && (
              <Button variant="outline" className="self-start" onClick={() => setConfirm('orders')}>
                Delete {plural(m.abandonedOrders, 'abandoned checkout')} (older than 30 days, never paid)
              </Button>
            )}
          </section>
        </>
      )}

      <Confirm
        open={confirm === 'pages'}
        title="Delete unused page folders?"
        lines={[
          `${plural(m?.unusedPageFolders.length ?? 0, 'folder')} of generated pages whose file no longer exists.`,
          'Pages of current files stay. Removed pages can be re-made from R2 → Website.',
        ]}
        busy={clean.isPending}
        onYes={() => clean.mutate({ what: 'pages' })}
        onClose={() => setConfirm(null)}
      />
      <Confirm
        open={confirm === 'orders'}
        title="Delete abandoned checkouts?"
        lines={[
          `${plural(m?.abandonedOrders ?? 0, 'checkout')} started more than 30 days ago and never paid.`,
          'No money moved for these; Razorpay keeps its own record.',
        ]}
        busy={clean.isPending}
        onYes={() => clean.mutate({ what: 'orders', olderThanDays: 30 })}
        onClose={() => setConfirm(null)}
      />
    </Panel>
  );
}
