import type { AdminCourseDto } from '@ss/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Sheet } from '../../shared/ui/feedback';
import { input } from './ui';

/** "Delete for good" for an archived course, with an explicit choice about its R2 notes. */
export function DeleteCourse({ course }: { course: AdminCourseDto }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(false);
  const [typed, setTyped] = useState('');
  const del = useMutation({
    mutationFn: () => api.adminDeleteCourse(course.id, notes),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const close = () => {
    setOpen(false);
    setTyped('');
    del.reset();
  };
  return (
    <>
      <Button variant="ghost" className="text-blush-text" onClick={() => setOpen(true)}>
        Delete for good…
      </Button>
      <Sheet open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} title="Delete this course?">
        <p className="m-0 text-[15px] text-ink2">
          <span className="font-semibold text-ink [overflow-wrap:anywhere]">{course.title}</span> and its
          units, files and generated pages are removed from the website and the database.
        </p>
        <label className="flex items-start gap-2.5 text-[14px]">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-teal"
            checked={notes}
            onChange={(e) => setNotes(e.target.checked)}
          />
          <span>
            Also delete its uploaded notes from R2
            <span className="block text-ink2">
              Leave this off to keep the original files in R2 (you can import them again later).
            </span>
          </span>
        </label>
        <p className="m-0 text-[13px] text-ink2">
          If any student bought or was given this course, it is kept archived instead: that is your sales
          history.
        </p>
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
          <Button variant="brand" disabled={typed !== 'DELETE' || del.isPending} onClick={() => del.mutate()}>
            {del.isPending ? 'Deleting…' : 'Delete course'}
          </Button>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </>
  );
}
