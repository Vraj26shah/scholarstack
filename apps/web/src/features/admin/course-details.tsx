import type { AdminCourseDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { BranchPicker } from './branch-picker';
import { DeleteCourse } from './delete-course';
import { OfferingsEditor } from './offerings-editor';
import { MoveFolderCard } from './storage-map-panel';
import { Field, input } from './ui';
import { YearSelect } from './year-select';

/** Invalidate everything a course change can show up in, so edits appear straight away. */
export function useCourseSave(c: AdminCourseDto, onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Parameters<typeof api.adminUpdateCourse>[1]) => api.adminUpdateCourse(c.id, patch),
    onSuccess: () => {
      onDone?.();
      for (const key of [
        'admin-courses',
        'catalogue',
        'drawer',
        'bundles',
        'course',
        'bundle',
        'admin-import',
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

/**
 * A course's details: title, code and description typed in; year and branches picked
 * from the lists set up under Years & branches. Archive and delete live here too.
 */
export function CourseDetails({ c }: { c: AdminCourseDto }) {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const [form, setForm] = useState({
    title: c.title,
    courseCode: c.courseCode ?? '',
    description: c.description,
    batchYear: String(c.batchYear),
    branchSlugs: c.branchSlugs,
  });
  const save = useCourseSave(c);
  const ok = form.title.trim().length >= 2 && /^\d{4}$/.test(form.batchYear) && form.branchSlugs.length > 0;
  const dirty =
    form.title !== c.title ||
    form.courseCode !== (c.courseCode ?? '') ||
    form.description !== c.description ||
    form.batchYear !== String(c.batchYear) ||
    form.branchSlugs.join(',') !== c.branchSlugs.join(',');

  return (
    <div className="flex flex-col gap-4">
      <OfferingsEditor c={c} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-2xl bg-sunk">
        <Field label="Title" className="sm:col-span-2">
          <input
            aria-label={`Title for ${c.title}`}
            className={input}
            value={form.title}
            maxLength={120}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Course code">
          <input
            aria-label={`Course code for ${c.title}`}
            className={`${input} font-mono uppercase`}
            value={form.courseCode}
            maxLength={24}
            placeholder="e.g. CSE3001"
            onChange={(e) =>
              setForm({ ...form, courseCode: e.target.value.toUpperCase().replace(/[^A-Z0-9._/-]/g, '') })
            }
          />
        </Field>
        <Field label="Filed under batch">
          <YearSelect
            label={`Batch year for ${c.title}`}
            value={form.batchYear}
            onChange={(batchYear) => setForm({ ...form, batchYear })}
          />
        </Field>
        <Field label="Filed under branches" className="lg:col-span-3">
          <BranchPicker
            branches={index.data?.branches ?? []}
            selected={form.branchSlugs}
            onChange={(branchSlugs) => setForm({ ...form, branchSlugs })}
            label={`Branches for ${c.title}`}
          />
        </Field>
        <Field label="Description" className="sm:col-span-2 lg:col-span-4">
          <textarea
            aria-label={`Description for ${c.title}`}
            className={`${input} h-24 py-2 resize-y`}
            value={form.description}
            maxLength={600}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
          <Button
            onClick={() =>
              save.mutate({
                title: form.title.trim(),
                courseCode: form.courseCode.trim() || null,
                description: form.description.trim(),
                batchYear: Number(form.batchYear),
                branchSlugs: form.branchSlugs,
                // A live course stays on sale (the server re-checks it can be sold).
                ...(c.status === 'live' ? { status: 'live' as const } : {}),
              })
            }
            disabled={save.isPending || !ok || !dirty}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          {save.isSuccess && !dirty && (
            <span className="text-sm text-teal-text" role="status">
              Saved. The site shows it now.
            </span>
          )}
          {save.isError && <span className="text-sm text-blush-text">{friendly(save.error)}</span>}
        </div>
      </div>
      <p className="m-0 font-mono text-[12px] text-ink2 break-all">Folder in storage: {c.r2Prefix}</p>
      <MoveFolderCard courseId={c.id} onMoved={() => undefined} />
      <section className="rounded-2xl p-4 shadow-[0_0_0_1px_var(--line)] flex flex-col gap-2">
        <strong>Take this course down</strong>
        <p className="m-0 text-sm text-ink2">
          Archive hides it for good but keeps everyone's history. An archived course nobody bought can then be
          deleted.
        </p>
        <div className="flex flex-wrap gap-2">
          {c.status !== 'archived' ? (
            <Button
              variant="outline"
              onClick={() => save.mutate({ status: 'archived' })}
              disabled={save.isPending}
            >
              Archive (hide for good)
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => save.mutate({ status: 'draft' })}
                disabled={save.isPending}
              >
                Bring back as a draft
              </Button>
              <DeleteCourse course={c} />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
