import type { AdminCourseBooksDto, CourseBookDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { env } from '../../lib/env';
import { Button } from '../../shared/ui/button';
import { Skeleton } from '../../shared/ui/feedback';
import { DeleteSheet } from './delete-sheet';
import { Field, input } from './ui';

const empty = { title: '', author: '', url: '', isbn: '', freeUrl: '', freeKind: 'read' as 'read' | 'pdf' };
type Draft = typeof empty;
const linkOk = (url: string) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(url.trim());
const isbnDigits = (v: string) => v.replace(/[\s-]/g, '').toUpperCase();
const isbnOk = (v: string) => /^(97[89])?\d{9}[\dX]$/.test(isbnDigits(v));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const coverSrc = (isbn: string) => `${env.apiBase.replace(/\/+$/, '')}/covers/${isbn}`;

/**
 * One form for adding or editing a book. An ISBN is the best way in: "Look up" fills the name
 * and author, and students get its cover, a preview, a free loan and a shop link. A free copy is
 * only ever an open textbook or one its authors publish free, never a pirated PDF.
 */
function BookForm({
  initial = empty,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Draft;
  busy: boolean;
  submitLabel: string;
  onSubmit: (b: Draft) => void;
  onCancel?: () => void;
}) {
  const [b, setB] = useState<Draft>(initial);
  const [lookup, setLookup] = useState<'idle' | 'busy' | 'none'>('idle');
  const isbn = b.isbn.trim();
  const free = b.freeUrl.trim();
  const url = b.url.trim();
  const problems = [
    b.title.trim().length < 2 && 'Give the book a name.',
    isbn && !isbnOk(isbn) && 'An ISBN has 10 or 13 digits.',
    url && !linkOk(url) && 'The link must start with https://',
    free && !/^https:\/\/\S+$/i.test(free) && 'The free copy must be an https:// link.',
    !url && !isbn && !free && 'Add an ISBN, a free copy or a link, so students can find it.',
  ].filter(Boolean) as string[];
  const ok = problems.length === 0;

  const findIsbn = async () => {
    setLookup('busy');
    try {
      const found = await api.adminLookupIsbn(isbnDigits(isbn));
      setB((x) => ({
        ...x,
        isbn: found.isbn,
        title: x.title.trim() ? x.title : found.title,
        author: x.author.trim() ? x.author : found.author,
      }));
      setLookup('idle');
    } catch {
      setLookup('none');
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok)
          onSubmit({
            title: b.title.trim(),
            author: b.author.trim(),
            url,
            isbn: isbn ? isbnDigits(isbn) : '',
            freeUrl: free,
            freeKind: b.freeKind,
          });
      }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-3 items-start">
        {isbnOk(isbn) ? (
          <img
            src={coverSrc(isbnDigits(isbn))}
            alt=""
            width={56}
            height={84}
            className="hidden sm:block w-14 h-21 rounded-[2px_5px_5px_2px] object-cover bg-sunk shadow-[0_0_0_1px_var(--line)]"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden';
            }}
          />
        ) : (
          <span aria-hidden="true" className="hidden sm:block w-14 h-21 rounded-[2px_5px_5px_2px] bg-line" />
        )}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1.4fr)] gap-2.5 items-end">
          <Field label="ISBN (best)">
            <div className="flex gap-1.5">
              <input
                className={`${input} font-mono`}
                value={b.isbn}
                maxLength={20}
                inputMode="numeric"
                placeholder="978-0-07-802215-9"
                onChange={(e) => {
                  setB({ ...b, isbn: e.target.value });
                  setLookup('idle');
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!isbnOk(isbn) || lookup === 'busy'}
                onClick={findIsbn}
              >
                {lookup === 'busy' ? 'Looking…' : 'Look up'}
              </Button>
            </div>
          </Field>
          <Field label="Book name">
            <input
              className={input}
              value={b.title}
              maxLength={200}
              placeholder="Database System Concepts"
              onChange={(e) => setB({ ...b, title: e.target.value })}
            />
          </Field>
          <Field label="Author (optional)">
            <input
              className={input}
              value={b.author}
              maxLength={120}
              placeholder="Silberschatz, Korth & Sudarshan"
              onChange={(e) => setB({ ...b, author: e.target.value })}
            />
          </Field>
        </div>
      </div>
      {lookup === 'none' && (
        <p className="m-0 text-[13px] text-ink2" role="status">
          Open Library doesn't know that ISBN. Check it, or type the name yourself.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_auto_minmax(0,2fr)] gap-2.5 items-end">
        <Field label="Free legal copy (optional)">
          <input
            className={input}
            type="url"
            inputMode="url"
            value={b.freeUrl}
            maxLength={500}
            placeholder="https://openstax.org/… (open textbooks only)"
            onChange={(e) => setB({ ...b, freeUrl: e.target.value })}
          />
        </Field>
        <Field label="It is">
          <select
            className={input}
            value={b.freeKind}
            disabled={!free}
            onChange={(e) => setB({ ...b, freeKind: e.target.value as Draft['freeKind'] })}
          >
            <option value="read">Read online</option>
            <option value="pdf">A PDF to download</option>
          </select>
        </Field>
        <Field label="Shop or publisher link (optional)">
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
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!ok || busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {!ok && b.title.trim() && <span className="text-[13px] text-ink2">{problems[0]}</span>}
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
  const [draft, setDraft] = useState<Draft | null>(null);
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
    mutationFn: (b: Draft) => api.adminAddBook(courseId, b),
    onSuccess: done,
  });
  const update = useMutation({
    mutationFn: ({ id, b }: { id: string; b: Draft }) => api.adminUpdateBook(id, b),
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
                  initial={{
                    title: b.title,
                    author: b.author,
                    isbn: b.isbn ?? '',
                    freeUrl: b.freeUrl ?? '',
                    freeKind: b.freeKind ?? 'read',
                    // The automatic Open Library / free-copy link isn't the admin's own link.
                    url:
                      b.url === b.freeUrl || b.url.startsWith('https://openlibrary.org/isbn/') ? '' : b.url,
                  }}
                  busy={update.isPending}
                  submitLabel="Save"
                  onSubmit={(next) => update.mutate({ id: b.id, b: next })}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {b.isbn ? (
                    <img
                      src={coverSrc(b.isbn)}
                      alt=""
                      loading="lazy"
                      width={32}
                      height={48}
                      className="flex-none w-8 h-12 rounded-[2px_4px_4px_2px] object-cover bg-sunk shadow-[0_0_0_1px_var(--line)]"
                      onError={(e) => {
                        e.currentTarget.style.visibility = 'hidden';
                      }}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`flex-none w-8 h-12 rounded-[2px_4px_4px_2px] ${b.freeUrl ? 'bg-teal' : 'bg-line'}`}
                    />
                  )}
                  <span className="min-w-0 flex-[1_1_220px]">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-ink truncate">{b.title}</span>
                      {b.freeUrl && (
                        <span className="flex-none h-5 px-1.5 rounded text-[11px] font-semibold inline-flex items-center bg-teal text-white">
                          FREE {b.freeKind === 'pdf' ? 'PDF' : 'ONLINE'}
                        </span>
                      )}
                    </span>
                    <span className="block text-[12px] text-ink2 truncate">
                      {b.author ? `${b.author} · ` : ''}
                      {b.isbn ? <span className="font-mono">ISBN {b.isbn} · </span> : null}
                      <a
                        href={b.freeUrl ?? b.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-text"
                      >
                        {host(b.freeUrl ?? b.url)} ↗
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
