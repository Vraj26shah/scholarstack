import type { StorageDeletePreviewDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet, Skeleton } from '../../shared/ui/feedback';
import { bytes } from './storage-map-panel';
import { U, input, plural } from './ui';

const KEY = ['admin', 'storage-tree'] as const;

/** Shows exactly what goes, then asks for DELETE. One path, or a whole selection. */
export function DeleteSheet({
  paths,
  label,
  onClose,
}: {
  paths: string[];
  /** What the selection is, in words ("12 unused files in Unit 2"). Defaults to the path. */
  label?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState('');
  const preview = useQuery({
    queryKey: ['admin', 'storage-preview', ...paths],
    queryFn: () => api.adminStoragePreview(paths),
  });
  const del = useMutation({
    mutationFn: () => api.adminStorageDelete(paths),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['admin', 'storage-unused'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'storage-map'] });
      void qc.invalidateQueries({ queryKey: ['admin-courses'] });
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
      <p className="m-0 font-mono text-[12px] text-ink2 break-all">
        {label ?? (paths.length === 1 ? paths[0] : plural(paths.length, 'item'))}
      </p>
      {paths.length > 1 && (
        <details className="text-[12px] text-ink2">
          <summary className="cursor-pointer font-semibold">Show what's picked</summary>
          <ul className="mt-1 mb-0 pl-4 max-h-40 overflow-y-auto font-mono break-all">
            {paths.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </details>
      )}
      {preview.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {preview.isError && <p className="m-0 text-sm text-blush-text">{friendly(preview.error)}</p>}
      {del.isSuccess ? (
        <>
          <p className="m-0 text-[15px]">
            Removed <U>{plural(del.data.removedObjects, 'file')}</U> ({bytes(del.data.removedBytes)}) from
            storage, {plural(del.data.removedPageObjects, 'page')} and{' '}
            {plural(del.data.removedFiles, 'record')} from the database.
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
              from storage,{' '}
              <U>
                {plural(p.pageObjects, 'page')} ({bytes(p.pageBytes)})
              </U>{' '}
              and <U>{plural(p.files, 'record')}</U> from the database.
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
