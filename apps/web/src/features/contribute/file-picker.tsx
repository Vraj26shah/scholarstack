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
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  maxFiles: number;
  /** File types the picker offers (the server checks again). */
  accept?: string;
  hint?: string;
  prompt?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => list && onChange(mergeFiles(files, [...list]));
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
          over ? 'border-teal bg-mist/40' : 'border-line bg-surface hover:border-ink2'
        }`}
      >
        <Upload size={28} className="text-teal-text" />
        <span className="text-[16px] font-semibold">{files.length ? 'Add more files' : prompt}</span>
        <span id={hint} className="text-[13px] text-ink2">
          {hintText ?? `PDF, PPT, Word, ZIP, JPG or PNG · up to ${maxFiles} files`}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
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
          {files.map((f, i) => (
            <li key={`${f.name}|${f.size}`} className="flex items-center gap-3 px-4 py-2.5 min-w-0">
              <span className="font-mono text-[11px] text-ink2 w-5 flex-none">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="flex-1 min-w-0 text-[14px] font-medium truncate" title={f.name}>
                {f.name}
              </span>
              <span className="flex-none font-mono text-[12px] text-ink2">{formatBytes(f.size)}</span>
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
          ))}
        </ul>
      )}
    </div>
  );
}
