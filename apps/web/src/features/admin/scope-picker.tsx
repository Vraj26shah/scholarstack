import type { ImportFolderDto, ImportObjectDto, ImportTreeDto } from '@ss/contracts';
import { useDeferredValue, useMemo, useState } from 'react';
import { buttonClass } from '../../shared/ui/button';
import { ChevronDown, Folder } from '../../shared/ui/icons';
import { input, plural } from './ui';

/** "" = everything; "a/b/" = a folder and all inside it; "a/b/c.pdf" = one file. */
export type Scope = string[];

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const scopeLabel = (entry: string, root: string) =>
  entry === '' ? 'Everything in R2' : entry.slice(root.length).replace(/\/$/, '') || 'Everything in R2';

/** Is this key already covered by a ticked folder (or "everything")? */
function coveredBy(scope: Scope, key: string): string | null {
  for (const entry of scope) {
    if (entry === '') return entry;
    if (entry.endsWith('/') && key !== entry && key.startsWith(entry)) return entry;
  }
  return null;
}

function Check({
  checked,
  disabled,
  label,
  onChange,
}: { checked: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="size-[18px] shrink-0 cursor-pointer accent-[var(--brand)] disabled:cursor-default"
    />
  );
}

function FileLine({
  object,
  depth,
  scope,
  toggle,
}: { object: ImportObjectDto; depth: number; scope: Scope; toggle: (entry: string) => void }) {
  const supported = object.classification === 'supported';
  const inherited = coveredBy(scope, object.key);
  const checked = scope.includes(object.key) || inherited !== null;
  return (
    <li
      className={`flex items-center gap-2.5 py-1.5 pr-3 text-[13px] ${supported ? '' : 'text-ink2'}`}
      style={{ paddingLeft: 12 + depth * 22 + 26 }}
    >
      <Check
        checked={supported && checked}
        disabled={!supported || inherited !== null}
        label={`Select file ${object.name}`}
        onChange={() => toggle(object.key)}
      />
      <span className="min-w-0 flex-1 truncate font-mono" title={object.key}>
        {object.name}
      </span>
      {!supported && (
        <span className="shrink-0 rounded bg-sunk px-1.5 text-[11px]">
          {object.classification === 'ignored' ? 'ignored' : 'not supported'}
        </span>
      )}
      <span className="shrink-0 text-xs text-ink2">{sizeLabel(object.sizeBytes)}</span>
    </li>
  );
}

function FolderBranch({
  folder,
  scope,
  toggle,
  open,
  setOpen,
}: {
  folder: ImportFolderDto;
  scope: Scope;
  toggle: (entry: string) => void;
  open: Set<string>;
  setOpen: (prefix: string) => void;
}) {
  const expanded = open.has(folder.prefix);
  const inherited = coveredBy(scope, folder.prefix);
  const checked = scope.includes(folder.prefix) || inherited !== null;
  return (
    <li>
      <div
        className="flex items-center gap-2.5 py-2 pr-3 hover:bg-sunk/60"
        style={{ paddingLeft: 12 + folder.depth * 22 }}
      >
        <button
          type="button"
          onClick={() => setOpen(folder.prefix)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Close' : 'Open'} ${folder.name}`}
          className="grid size-5 shrink-0 place-items-center text-ink2"
        >
          <ChevronDown size={15} className={`transition-transform ${expanded ? '' : '-rotate-90'}`} />
        </button>
        <Check
          checked={checked}
          disabled={inherited !== null}
          label={`Select folder ${folder.name}`}
          onChange={() => toggle(folder.prefix)}
        />
        <Folder size={16} className="shrink-0 text-teal-text" />
        <button
          type="button"
          onClick={() => setOpen(folder.prefix)}
          className="min-w-0 flex-1 truncate text-left text-[14px] font-semibold"
        >
          {folder.name}
        </button>
        {folder.course ? (
          <span className="hidden shrink-0 rounded-md bg-mist px-2 py-0.5 text-[11px] font-semibold text-on-mist sm:inline">
            course · {folder.course.status}
          </span>
        ) : folder.supportedCount > 0 && folder.depth > 0 ? (
          <span className="hidden shrink-0 rounded-md bg-marigold-soft px-2 py-0.5 text-[11px] font-semibold text-marigold-text sm:inline">
            not imported
          </span>
        ) : null}
        <span className="shrink-0 text-xs text-ink2">{plural(folder.supportedCount, 'file')}</span>
      </div>
      {expanded && (
        <ul className="m-0 list-none p-0">
          {folder.children.map((child) => (
            <FolderBranch
              key={child.prefix}
              folder={child}
              scope={scope}
              toggle={toggle}
              open={open}
              setOpen={setOpen}
            />
          ))}
          {folder.looseObjects.map((object) => (
            <FileLine
              key={object.key}
              object={object}
              depth={folder.depth + 1}
              scope={scope}
              toggle={toggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function flatten(folders: ImportFolderDto[]): { folders: ImportFolderDto[]; files: ImportObjectDto[] } {
  const all = { folders: [] as ImportFolderDto[], files: [] as ImportObjectDto[] };
  const walk = (folder: ImportFolderDto) => {
    all.folders.push(folder);
    all.files.push(...folder.looseObjects);
    folder.children.forEach(walk);
  };
  folders.forEach(walk);
  return all;
}

/** Search shows this many folders and files each; the full count is always stated. */
const SEARCH_LIMIT = 2000;

export function ScopePicker({
  tree,
  scope,
  onChange,
}: { tree: ImportTreeDto; scope: Scope; onChange: (scope: Scope) => void }) {
  const [open, setOpenState] = useState<Set<string>>(() => new Set(tree.folders.map((f) => f.prefix)));
  const [query, setQuery] = useState('');
  const everything = scope.includes('');
  const flat = useMemo(() => flatten(tree.folders), [tree]);

  const toggle = (entry: string) => {
    const next = scope.includes(entry)
      ? scope.filter((item) => item !== entry)
      : // Ticking a folder replaces anything already picked inside it.
        [...scope.filter((item) => !(entry.endsWith('/') && item.startsWith(entry))), entry];
    onChange(next);
  };
  const setOpen = (prefix: string) =>
    setOpenState((current) => {
      const next = new Set(current);
      if (next.has(prefix)) next.delete(prefix);
      else next.add(prefix);
      return next;
    });

  // Typing stays instant on big buckets: the filter runs on a deferred copy of the query.
  const q = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo(() => {
    if (!q) return null;
    const folders = flat.folders.filter((f) => f.prefix.toLowerCase().includes(q));
    const files = flat.files.filter((f) => f.key.toLowerCase().includes(q));
    return {
      folders: folders.slice(0, SEARCH_LIMIT),
      files: files.slice(0, SEARCH_LIMIT),
      total: folders.length + files.length,
    };
  }, [q, flat]);

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="What to check" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            [true, 'Everything in R2', `All ${plural(tree.totalFiles, 'file')} under ${tree.root}`],
            [false, 'Only some folders or files', 'Tick exactly what you want below'],
          ] as const
        ).map(([all, title, hint]) => {
          const active = all === everything;
          return (
            <button
              key={title}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(all ? [''] : scope.filter((item) => item !== ''))}
              className={`flex flex-col gap-0.5 rounded-xl border-[1.5px] px-4 py-3 text-left transition ${
                active
                  ? 'border-brand bg-surface shadow-[0_10px_24px_-18px_rgba(47,60,126,0.7)]'
                  : 'border-line bg-surface/60 hover:border-ink2'
              }`}
            >
              <span className="flex items-center gap-2 font-semibold">
                <span
                  aria-hidden
                  className={`size-4 rounded-full border-[1.5px] ${active ? 'border-brand bg-brand shadow-[inset_0_0_0_3px_var(--surface)]' : 'border-line'}`}
                />
                {title}
              </span>
              <span className="pl-6 text-xs text-ink2">{hint}</span>
            </button>
          );
        })}
      </div>

      {!everything && (
        <div className="flex flex-col overflow-hidden rounded-xl border-[1.5px] border-line bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <input
              type="search"
              aria-label="Find a folder or file in R2"
              placeholder="Find a folder or file…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${input} h-10 min-w-0 basis-full sm:basis-auto sm:flex-1`}
            />
            <button
              type="button"
              className={buttonClass('ghost', 'md', 'h-10 px-3 text-[13px]')}
              onClick={() => setOpenState(new Set(flat.folders.map((f) => f.prefix)))}
            >
              Open all
            </button>
            <button
              type="button"
              className={buttonClass('ghost', 'md', 'h-10 px-3 text-[13px]')}
              onClick={() => setOpenState(new Set())}
            >
              Close all
            </button>
          </div>
          <ul
            className="m-0 max-h-[440px] list-none overflow-auto p-0 py-1"
            aria-label="R2 folders and files"
          >
            {matches ? (
              <>
                {matches.folders.map((folder) => (
                  <li key={folder.prefix} className="flex items-center gap-2.5 px-3 py-1.5 text-[13px]">
                    <Check
                      checked={scope.includes(folder.prefix) || coveredBy(scope, folder.prefix) !== null}
                      disabled={coveredBy(scope, folder.prefix) !== null}
                      label={`Select folder ${folder.name}`}
                      onChange={() => toggle(folder.prefix)}
                    />
                    <Folder size={15} className="text-teal-text" />
                    <span className="truncate font-semibold">{folder.prefix.slice(tree.root.length)}</span>
                  </li>
                ))}
                {matches.files.map((object) => (
                  <FileLine key={object.key} object={object} depth={-1} scope={scope} toggle={toggle} />
                ))}
                {matches.total > matches.folders.length + matches.files.length && (
                  <li className="px-4 py-3 text-[13px] text-ink2">
                    Showing {(matches.folders.length + matches.files.length).toLocaleString('en-IN')} of{' '}
                    {matches.total.toLocaleString('en-IN')} matches. Type more of the name to narrow it down,
                    or tick the folder that holds them.
                  </li>
                )}
                {!matches.folders.length && !matches.files.length && (
                  <li className="px-4 py-6 text-sm text-ink2">Nothing in R2 matches “{query}”.</li>
                )}
              </>
            ) : (
              <>
                {tree.folders.map((folder) => (
                  <FolderBranch
                    key={folder.prefix}
                    folder={folder}
                    scope={scope}
                    toggle={toggle}
                    open={open}
                    setOpen={setOpen}
                  />
                ))}
                {tree.rootFiles.map((object) => (
                  <FileLine key={object.key} object={object} depth={-1} scope={scope} toggle={toggle} />
                ))}
              </>
            )}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="text-sm font-semibold">Selected:</span>
        {scope.length === 0 && (
          <span className="text-sm text-ink2">Nothing yet. Tick a folder or a file.</span>
        )}
        {scope.map((entry) => (
          <span
            key={entry}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-sunk py-1 pl-3 pr-1 text-[13px]"
          >
            {entry === '' || entry.endsWith('/') ? <Folder size={13} className="text-teal-text" /> : null}
            <span className="truncate" title={entry || tree.root}>
              {scopeLabel(entry, tree.root)}
            </span>
            <button
              type="button"
              aria-label={`Remove ${scopeLabel(entry, tree.root)}`}
              onClick={() => onChange(scope.filter((item) => item !== entry))}
              className="grid size-6 place-items-center rounded-full text-ink2 hover:bg-line hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        {scope.length > 1 && (
          <button
            type="button"
            className="text-[13px] font-semibold text-teal-text underline"
            onClick={() => onChange([])}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
