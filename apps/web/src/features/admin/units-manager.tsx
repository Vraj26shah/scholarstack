import type { AdminUnitDto, UnitKind } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, friendly } from '../../lib/api';
import { fileFormatLabel, formatBytes } from '../../lib/format';
import { Skeleton } from '../../shared/ui/feedback';
import { plural } from './ui';

const KIND_LABEL: Record<UnitKind, string> = {
  module: 'Module',
  pyq: 'PYQs',
  syllabus: 'Syllabus',
  lab: 'Lab',
  revision: 'Revision',
  notes: 'Notes',
  reference: 'Reference books',
  other: 'Other',
};

function VisibilitySwitch({
  hidden,
  label,
  disabled,
  onChange,
}: {
  hidden: boolean;
  label: string;
  disabled?: boolean;
  onChange: (hidden: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!hidden}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!hidden)}
      className={`flex-none inline-flex items-center gap-2 h-8 pl-1 pr-3 rounded-full border text-xs font-semibold cursor-pointer transition disabled:opacity-50 ${
        hidden ? 'border-line bg-sunk text-ink2' : 'border-teal/40 bg-surface text-teal-text'
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-6 h-6 rounded-full transition ${hidden ? 'bg-line' : 'bg-teal'}`}
      />
      {hidden ? 'Hidden' : 'On the site'}
    </button>
  );
}

/**
 * Every unit and file of a course, including those kept off the site. Reference-book folders
 * and files that look like publishers' textbooks start hidden; showing one converts it and,
 * for a published course, moves it back to draft until its pages are ready.
 */
export function UnitsManager({ courseId, live }: { courseId: string; live: boolean }) {
  const qc = useQueryClient();
  const key = ['admin-units', courseId];
  const units = useQuery({ queryKey: key, queryFn: () => api.adminUnits(courseId) });
  const done = (next: AdminUnitDto[]) => {
    qc.setQueryData(key, next);
    void qc.invalidateQueries({ queryKey: ['admin-courses'] });
    void qc.invalidateQueries({ queryKey: ['course'] });
  };
  const unit = useMutation({
    mutationFn: (v: { key: string; hidden: boolean }) => api.adminSetUnitHidden(courseId, v.key, v.hidden),
    onSuccess: done,
  });
  const file = useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) => api.adminSetFileHidden(v.id, v.hidden),
    onSuccess: done,
  });
  const busy = unit.isPending || file.isPending;

  if (units.isLoading) return <Skeleton className="h-40" />;
  if (units.isError) return <p className="m-0 text-sm text-blush-text">{friendly(units.error)}</p>;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-2xl bg-sunk">
      <p className="m-0 text-sm text-ink2 max-w-[760px]">
        Hidden units and files are never listed, previewed, sold or converted. Reference books and files that
        look like publishers' textbooks start hidden: only show material you have the right to sell.
        {live && ' Showing something here moves this course back to draft until its pages are ready.'}
      </p>
      <ul className="list-none m-0 p-0 flex flex-col gap-2">
        {units.data?.map((u) => (
          <li key={u.key} className="rounded-xl border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-3 p-3">
              <span
                className={`font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                  u.kind === 'reference' ? 'bg-blush text-blush-text' : 'bg-brand text-white'
                }`}
              >
                {u.label}
              </span>
              <span className="font-semibold mr-auto min-w-0 truncate">
                {u.title}
                <span className="ml-2 font-mono text-xs font-normal text-ink2">
                  {KIND_LABEL[u.kind]} · {plural(u.files.length, 'file')}
                </span>
              </span>
              <VisibilitySwitch
                hidden={u.hidden}
                label={`${u.title}: ${u.hidden ? 'hidden' : 'on the site'}`}
                disabled={busy}
                onChange={(hidden) => unit.mutate({ key: u.key, hidden })}
              />
            </div>
            <ul className="list-none m-0 p-0 border-t border-line">
              {u.files.map((f) => (
                <li
                  key={f.id}
                  className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${u.hidden ? 'opacity-55' : ''}`}
                >
                  <span className="min-w-0 flex-[1_1_240px] truncate" title={f.name}>
                    {f.name}
                  </span>
                  <span className="font-mono text-xs text-ink2">
                    {fileFormatLabel(f.format, f.name)} · {formatBytes(f.sizeBytes)}
                    {f.pageCount > 0 && ` · ${f.pageCount} pp`}
                    {f.status === 'pending' && ' · pending conversion'}
                    {f.status === 'ready' && ' · ready'}
                    {f.status === 'failed' && <span className="text-blush-text"> · failed</span>}
                  </span>
                  <VisibilitySwitch
                    hidden={f.hidden}
                    label={`${f.name}: ${f.hidden ? 'hidden' : 'on the site'}`}
                    disabled={busy}
                    onChange={(hidden) => file.mutate({ id: f.id, hidden })}
                  />
                  {f.status === 'failed' && f.error && (
                    <span className="basis-full text-xs leading-relaxed text-blush-text">
                      {f.error.replace(/^Broken source:\s*/, 'Needs a new copy: ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {(unit.isError || file.isError) && (
        <p className="m-0 text-sm text-blush-text">{friendly(unit.error ?? file.error)}</p>
      )}
    </div>
  );
}
