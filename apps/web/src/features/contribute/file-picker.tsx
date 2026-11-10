import { useId, useRef, useState } from 'react';
import { Cross, Upload } from '../../shared/ui/icons';
import { ACCEPT_ATTR, formatBytes, mergeFiles } from './rules';

/** Drop files or pick them; shows what's chosen with a way to take each one out. */
export function FilePicker({
  files,
  onChange,
  disabled,
  maxFiles,
  accept = ACCEPT_ATTR,
  hint: hintText,
  prompt = 'Drop files here, or tap to choose',
  issues,
  totalLimit,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles: number;
  /** File types the picker offers (the server checks again). */
  accept?: string;
  hint?: string;
  prompt?: string;
  /** What is wrong with each file, keyed `${name}|${size}`; marked on its row. */
  issues?: Map<string, string>;
  /** Total bytes allowed, shown as a meter under the list. */
  totalLimit?: number;
}) {
  // Files already turned away (type, size) don't count towards the total.
  const total = files.reduce((t, f) => {
    const issue = issues?.get(`${f.name}|${f.size}`);
    return !issue || issue.startsWith('Pushes') ? t + f.size : t;
  }, 0);
  const over = totalLimit !== undefined && total > totalLimit;
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [dragOver, setOver] = useState(false);
  // With room for one file, a new pick replaces the old one.
  const add = (list: FileList | null) =>
    list?.length && onChange(maxFiles === 1 ? [list[0]!] : mergeFiles(files, [...list]));
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        disabled={disabled}
        aria-describedby={hint}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`group flex flex-col items-center justify-center gap-2 rounded-[18px] border-2 border-dashed px-5 py-9 text-center transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
          dragOver ? 'border-teal bg-mist/40' : 'border-line bg-surface hover:border-ink2'
        }`}
      >
        <Upload size={28} className="text-teal-text" />
        <span className="text-[16px] font-semibold">{files.length ? 'Add more files' : prompt}</span>
        <span id={hint} className="text-[13px] text-ink2">
          {hintText ??
            (maxFiles === 1
              ? 'One file: a ZIP of the whole subject, or one PDF, PPT or Word file'
              : `Up to ${maxFiles} files`)}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple={maxFiles > 1}
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          add(e.target.files);
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="m-0 p-0 list-none flex flex-col divide-y divide-line rounded-[14px] shadow-[0_0_0_1px_var(--line)] bg-card">
          {files.map((f, i) => {
            const issue = issues?.get(`${f.name}|${f.size}`);
            return (
              <li
                key={`${f.name}|${f.size}`}
                className={`flex items-center gap-3 px-4 py-2.5 min-w-0 ${issue ? 'bg-blush/50' : ''}`}
              >
                <span className="font-mono text-[11px] text-ink2 w-5 flex-none">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="text-[14px] font-medium truncate" title={f.name}>
                    {f.name}
                  </span>
                  {issue && <span className="text-[12px] font-semibold text-blush-text">{issue}</span>}
                </span>
                <span
                  className={`flex-none font-mono text-[12px] ${issue ? 'text-blush-text font-semibold' : 'text-ink2'}`}
                >
                  {formatBytes(f.size)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                  className="flex-none size-8 inline-flex items-center justify-center rounded-full text-ink2 hover:bg-sunk disabled:opacity-50"
                >
                  <Cross size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {files.length > 0 && totalLimit !== undefined && (
        <div className="flex flex-col gap-1" aria-live="polite">
          <div className="h-1.5 rounded-full bg-sunk overflow-hidden">
            <div
              className={`h-full ${over ? 'bg-blush-text' : 'bg-teal'}`}
              style={{ width: `${Math.min(100, Math.round((total / totalLimit) * 100))}%` }}
            />
          </div>
          <span className={`font-mono text-[12px] ${over ? 'text-blush-text font-semibold' : 'text-ink2'}`}>
            {formatBytes(total)} of {formatBytes(totalLimit)}
            {over ? ` · remove ${formatBytes(total - totalLimit)} (marked files)` : ''}
          </span>
        </div>
      )}
    </div>
  );
}
