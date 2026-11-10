import type { AdminCourseBooksDto, CourseBookDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { DeleteSheet } from './delete-sheet';
import { Field, input } from './ui';

const empty = { title: '', author: '', url: '' };
const linkOk = (url: string) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** One form for adding or editing a book: name, author (optional) and the link. */
function BookForm({
  initial = empty,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: typeof empty;
  busy: boolean;
  submitLabel: string;
  onSubmit: (b: typeof empty) => void;
  onCancel?: () => void;
}) {
  const [b, setB] = useState(initial);
  const ok = b.title.trim().length >= 2 && linkOk(b.url);
  return (
    <form
      className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr_auto] gap-2.5 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit({ title: b.title.trim(), author: b.author.trim(), url: b.url.trim() });
      }}
    >
      <Field label="Book name">
        <input
          className={input}
          value={b.title}
          maxLength={200}
          placeholder="Physical Chemistry"
          onChange={(e) => setB({ ...b, title: e.target.value })}
        />
      </Field>
      <Field label="Author (optional)">
        <input
          className={input}
          value={b.author}
          maxLength={120}
          placeholder="Atkins & de Paula"
          onChange={(e) => setB({ ...b, author: e.target.value })}
        />
      </Field>
      <Field label="Link">
        <input
          className={input}
          type="url"
          inputMode="url"
          value={b.url}
          maxLength={500}
          placeholder="https://…"
          onChange={(e) => setB({ ...b, url: e.target.value })}
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={!ok || busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Recommended books for one course. The admin keeps a name and a link per book; students see
 * them on the course page straight away. Titles spotted in the course folder can be added in
 * one tap (a link is still needed).
 */
export function BooksManager({ courseId, slug }: { courseId: string; slug: string }) {
  const qc = useQueryClient();
  const key = ['admin-books', courseId];
  const books = useQuery({ queryKey: key, queryFn: () => api.adminBooks(courseId) });
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<typeof empty | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [sourceDelete, setSourceDelete] = useState<{ title: string; paths: string[] } | null>(null);
  const done = (data: AdminCourseBooksDto) => {
    qc.setQueryData(key, data);
    setEditing(null);
    setDraft(null);
    setConfirmDelete(null);
    void qc.invalidateQueries({ queryKey: ['course', slug] });
  };
  const add = useMutation({
    mutationFn: (b: typeof empty) => api.adminAddBook(courseId, b),
    onSuccess: done,
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: string; b: typeof empty }) => api.adminUpdateBook(id, b),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: (id: string) => api.adminDeleteBook(id), onSuccess: done });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.adminOrderBooks(courseId, ids),
    onSuccess: done,
  });
  const error = add.error ?? update.error ?? remove.error ?? order.error;

  if (books.isPending) return <Skeleton className="h-24" />;
  if (books.isError && !books.data)
    return <p className="m-0 text-sm text-blush-text">{friendly(books.error)}</p>;
  const list = books.data.books;
  const move = (i: number, by: -1 | 1) => {
    const ids = list.map((b) => b.id);
    const [x] = ids.splice(i, 1);
    ids.splice(i + by, 0, x!);
    order.mutate(ids);
  };

  return (
    <section aria-label="Recommended books" className="flex flex-col gap-3 p-4 rounded-2xl bg-sunk">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="m-0 font-semibold text-[15px]">Recommended books</h4>
        <span className="text-[13px] text-ink2">
          {list.length
            ? 'Students see exactly this list on the course page.'
            : 'None added yet: students see the textbook titles found in the folder.'}
        </span>
      </div>

      {list.length > 0 && (
        <ol className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-xl bg-surface shadow-[0_0_0_1px_var(--line)]">
          {list.map((b: CourseBookDto, i) => (
            <li key={b.id} className="px-3 py-2.5">
              {editing === b.id ? (
                <BookForm
                  initial={{ title: b.title, author: b.author, url: b.url }}
                  busy={update.isPending}
                  submitLabel="Save"
                  onSubmit={(next) => update.mutate({ id: b.id, b: next })}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="min-w-0 flex-[1_1_220px]">
                    <span className="block font-medium text-ink truncate">{b.title}</span>
                    <span className="block text-[12px] text-ink2 truncate">
                      {b.author ? `${b.author} · ` : ''}
                      <a href={b.url} target="_blank" rel="noopener noreferrer" className="text-teal-text">
                        {host(b.url)} ↗
                      </a>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${b.title} up`}
                      disabled={i === 0 || order.isPending}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Move ${b.title} down`}
                      disabled={i === list.length - 1 || order.isPending}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditing(b.id)}>
                      Edit
                    </Button>
                    {confirmDelete === b.id ? (
                      <>
                        <span className="text-xs text-ink2" role="status">
                          Delete this book?
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(b.id)}
                        >
                          {remove.isPending ? 'Deleting…' : 'Delete book'}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${b.title}`}
                        disabled={remove.isPending}
                        onClick={() => setConfirmDelete(b.id)}
                      >
                        Delete
                      </Button>
                    )}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {draft ? (
        <BookForm
          key={draft.title}
          initial={draft}
          busy={add.isPending}
          submitLabel="Add book"
          onSubmit={(b) => add.mutate(b)}
          onCancel={() => setDraft(null)}
        />
      ) : (
        <div>
          <Button variant="outline" size="sm" onClick={() => setDraft(empty)} disabled={list.length >= 20}>
            + Add a book
          </Button>
        </div>
      )}

      {books.data.found.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-[13px] text-ink2">
            Found in this course’s folder. Add a title with its link, or delete its source files:
          </p>
          <ul className="m-0 p-0 list-none flex flex-wrap gap-1.5">
            {books.data.found.map((f) => (
              <li key={f.title} className="flex items-center gap-1">
                <button
                  type="button"
                  className="h-8 px-3 rounded-full border border-line bg-surface text-[13px] text-ink cursor-pointer hover:border-teal"
                  onClick={() => setDraft({ ...empty, title: f.title })}
                >
                  + {f.title}
                </button>
                <button
                  type="button"
                  className="h-8 px-2.5 rounded-full border border-line bg-surface text-[12px] text-ink2 cursor-pointer hover:border-blush hover:text-blush-text"
                  aria-label={`Delete source files for ${f.title}`}
                  onClick={() => setSourceDelete({ title: f.title, paths: f.sourceKeys })}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
      {sourceDelete && (
        <DeleteSheet
          paths={sourceDelete.paths}
          label={`Reference book source: ${sourceDelete.title}`}
          onClose={() => {
            setSourceDelete(null);
            void qc.invalidateQueries({ queryKey: key });
            void qc.invalidateQueries({ queryKey: ['course', slug] });
          }}
        />
      )}
    </section>
  );
}
