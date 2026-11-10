import { WINTER_2026_27_TITLES } from '@ss/contracts';
import { useId, useMemo, useRef, useState } from 'react';
import { field } from '../../core/ui';

export interface ListedCourse {
  code: string;
  name: string;
}

/** Every course on this term's course list, plus any catalogue titles it doesn't name. */
export function useCourseList(extraNames: string[] = []): ListedCourse[] {
  return useMemo(() => {
    const listed = Object.entries(WINTER_2026_27_TITLES).map(([code, name]) => ({ code, name: tidy(name) }));
    const known = new Set(listed.map((c) => norm(c.name)));
    const extra = extraNames.filter((n) => !known.has(norm(n))).map((name) => ({ code: '', name }));
    return [...listed, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [extraNames]);
}

const SMALL = new Set(['and', 'of', 'in', 'for', 'the', 'to', 'with', 'on', 'a']);
/** "DATA STRUCTURES AND ANALYSIS OF ALGORITHMS" → "Data Structures and Analysis of Algorithms". */
const tidy = (name: string) =>
  name === name.toUpperCase() && /[A-Z]{3}/.test(name)
    ? name
        .toLowerCase()
        .split(' ')
        .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ')
    : name;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** The one course this name or code names on the list, if exactly one does. */
export function exactMatch(list: ListedCourse[], by: 'name' | 'code', text: string): ListedCourse | null {
  const t = norm(text);
  if (!t) return null;
  const hits = list.filter((c) => norm(by === 'name' ? c.name : c.code) === t);
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * A text box with a list under it: typing narrows the list (by name or code), picking one fills
 * both fields, and the last row is always "Other", for a course that isn't listed.
 */
export function SearchField({
  label,
  value,
  onType,
  onPick,
  onOther,
  list,
  by,
  placeholder,
  other,
}: {
  label: string;
  value: string;
  onType: (text: string) => void;
  onPick: (c: ListedCourse) => void;
  onOther: () => void;
  list: ListedCourse[];
  by: 'name' | 'code';
  placeholder: string;
  /** In "Other" mode the box is plain text: no list, nothing filled in for you. */
  other: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const closeTimer = useRef<number | undefined>(undefined);
  const q = norm(value);
  const matches = (q ? list.filter((c) => norm(c.name).includes(q) || norm(c.code).includes(q)) : list).slice(
    0,
    8,
  );
  // The rows: matches, then "Other" (always there, so nobody is stuck when theirs is missing).
  const rows = matches.length + 1;
  const choose = (i: number) => {
    if (i < matches.length) onPick(matches[i]!);
    else onOther();
    setOpen(false);
  };
  const show = open && !other;

  return (
    <div className="relative flex flex-col gap-1.5 min-w-0">
      <label htmlFor={id} className="text-sm font-semibold text-ink2">
        {label}
      </label>
      <input
        id={id}
        className={`${field} ${by === 'code' ? 'uppercase' : ''}`}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role={other ? undefined : 'combobox'}
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        onFocus={() => {
          window.clearTimeout(closeTimer.current);
          setOpen(true);
          setActive(0);
        }}
        // Close a moment later, so a tap on a row lands before the list goes away.
        onBlur={() => {
          closeTimer.current = window.setTimeout(() => setOpen(false), 150);
        }}
        onChange={(e) => {
          onType(by === 'code' ? e.target.value.toUpperCase() : e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (other) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (a + 1) % rows);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => (a - 1 + rows) % rows);
          } else if (e.key === 'Enter' && show) {
            e.preventDefault();
            choose(active);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {show && (
        <div
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label="Matching courses"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl bg-card p-1 shadow-[0_18px_40px_-18px_var(--shadow),0_0_0_1px_var(--line)] "
        >
          {matches.map((c, i) => (
            <div
              key={`${c.code}|${c.name}`}
              role="option"
              tabIndex={-1}
              onKeyDown={(e) => e.key === 'Enter' && choose(i)}
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(i)}
              onMouseEnter={() => setActive(i)}
              className={`flex items-baseline gap-2.5 rounded-lg px-3 py-2 cursor-pointer text-[14px] ${
                i === active ? 'bg-mist/50' : ''
              }`}
            >
              <span className="w-[4.5rem] shrink-0 font-mono text-[12px] text-ink2">{c.code || '·'}</span>
              <span className="min-w-0 text-ink">{c.name}</span>
            </div>
          ))}
          {matches.length === 0 && (
            <p className="m-0 px-3 py-2 text-[13px] text-ink2">Not on the course list.</p>
          )}
          <div
            role="option"
            tabIndex={-1}
            onKeyDown={(e) => e.key === 'Enter' && choose(matches.length)}
            aria-selected={active === matches.length}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(matches.length)}
            onMouseEnter={() => setActive(matches.length)}
            // Pinned to the bottom of the list, so it shows however many courses match.
            className={`sticky -bottom-1 mt-1 border-t border-line/70 rounded-lg bg-card shadow-[0_-10px_14px_-12px_var(--shadow)] px-3 py-2.5 cursor-pointer text-[14px] font-semibold text-teal-text ${
              active === matches.length ? 'bg-mist/50' : ''
            }`}
          >
            Other: my course isn't listed
          </div>
        </div>
      )}
    </div>
  );
}
