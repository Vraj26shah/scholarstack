import { CONTRIBUTION_LIMITS, type ZipLayout, zipLayout } from '@ss/contracts';
import { useEffect, useState } from 'react';
import { formatBytes } from './rules';
import { type ZipFileEntry, zipEntries } from './zip-names';

/** Reads each picked ZIP's file names (nothing is unpacked) and works out its layout. */
function useLayouts(files: File[], onScanState?: (problems: string[] | null) => void) {
  const [out, setOut] = useState<Record<string, { layout: ZipLayout; files: ZipFileEntry[] } | 'unreadable'>>(
    {},
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, { layout: ZipLayout; files: ZipFileEntry[] } | 'unreadable'> = {};
      const problems: string[] = [];
      const zips = files.filter((file) => file.name.toLowerCase().endsWith('.zip'));
      onScanState?.(zips.length ? null : []);
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.zip')) continue;
        const key = `${file.name}|${file.size}`;
        try {
          const entries = zipEntries(new Uint8Array(await file.arrayBuffer()));
          next[key] = entries
            ? { layout: zipLayout(entries.map((entry) => entry.path)), files: entries }
            : 'unreadable';
          if (!entries)
            problems.push(`${file.name}: this ZIP can't be read. Zip the folder again and pick it.`);
          else {
            const oversized = entries.filter((entry) => entry.size > CONTRIBUTION_LIMITS.archiveEntryBytes);
            const total = entries.reduce((sum, entry) => sum + entry.size, 0);
            if (entries.length > CONTRIBUTION_LIMITS.archiveEntries)
              problems.push(
                `${file.name}: ${entries.length} files inside; the limit is ${CONTRIBUTION_LIMITS.archiveEntries}.`,
              );
            for (const entry of oversized.slice(0, 5))
              problems.push(
                `${file.name} › ${entry.path}: ${formatBytes(entry.size)} unpacked; each ZIP file must be under ${formatBytes(CONTRIBUTION_LIMITS.archiveEntryBytes)}.`,
              );
            if (oversized.length > 5)
              problems.push(
                `${file.name}: ${oversized.length - 5} more ZIP files exceed the per-file limit.`,
              );
            if (total > CONTRIBUTION_LIMITS.archiveUnpackedBytes) {
              const largest = [...entries].sort((a, b) => b.size - a.size).slice(0, 3);
              problems.push(
                `${file.name}: contents total ${formatBytes(total)}; the limit is ${formatBytes(CONTRIBUTION_LIMITS.archiveUnpackedBytes)}. Largest: ${largest.map((entry) => entry.path).join(', ')}.`,
              );
            }
          }
        } catch {
          next[key] = 'unreadable';
          problems.push(`${file.name}: this ZIP can't be read. Zip the folder again and pick it.`);
        }
        if (alive) setOut({ ...next });
      }
      if (alive) onScanState?.(problems);
    })();
    return () => {
      alive = false;
    };
  }, [files, onScanState]);
  return out;
}

/**
 * Under the file picker: for each ZIP, whether it is a whole subject (Syllabus + units), which
 * earns 30% of every sale, and what to add if it isn't.
 */
export function ZipCheck({
  files,
  onScanState,
}: {
  files: File[];
  onScanState?: (problems: string[] | null) => void;
}) {
  const layouts = useLayouts(files, onScanState);
  const zips = files.filter((f) => layouts[`${f.name}|${f.size}`]);
  if (!zips.length) return null;
  return (
    <ul aria-label="ZIP format check" className="m-0 p-0 list-none flex flex-col gap-2">
      {zips.map((f) => {
        const archive = layouts[`${f.name}|${f.size}`]!;
        if (archive === 'unreadable')
          return (
            <li key={f.name} className="rounded-xl bg-blush/60 px-4 py-3 text-[14px] text-blush-text">
              <strong>{f.name}</strong>: this ZIP can't be read. Zip the folder again and pick it.
            </li>
          );
        const l = archive.layout;
        const tree = [...archive.files].sort((a, b) =>
          a.path.localeCompare(b.path, undefined, { numeric: true }),
        );
        const unpackedBytes = tree.reduce((total, file) => total + file.size, 0);
        const oversized = tree.filter((file) => file.size > CONTRIBUTION_LIMITS.archiveEntryBytes);
        const tooMany = tree.length > CONTRIBUTION_LIMITS.archiveEntries;
        const tooMuchUnpacked = unpackedBytes > CONTRIBUTION_LIMITS.archiveUnpackedBytes;
        const largest = [...tree].sort((a, b) => b.size - a.size).slice(0, 3);
        const broken = tooMany || tooMuchUnpacked || oversized.length > 0;
        // Which folders inside hold the most, so the student knows what to take out or zip apart.
        const byFolder = new Map<string, { files: number; bytes: number }>();
        for (const entry of tree) {
          const parts = entry.path.split('/');
          const folder =
            parts.length > 1 ? parts.slice(0, Math.min(2, parts.length - 1)).join('/') : '(top level)';
          const f = byFolder.get(folder) ?? { files: 0, bytes: 0 };
          f.files++;
          f.bytes += entry.size;
          byFolder.set(folder, f);
        }
        const folders = [...byFolder.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 6);
        const tooBig = new Set(oversized.map((entry) => entry.path));
        return (
          <li
            key={f.name}
            className={`rounded-xl px-4 py-3 text-[14px] leading-relaxed ${
              l.wholeSubject ? 'bg-mist/40 text-ink' : 'bg-marigold-soft text-ink'
            }`}
          >
            <strong>{f.name}</strong>
            {broken ? (
              <div className="mt-2 rounded-xl border border-blush-text/25 bg-blush/50 p-3 text-[13px] text-blush-text">
                <strong>Needs a quick edit before upload</strong>
                <ul className="m-0 mt-1.5 list-disc pl-5">
                  {tooMany && (
                    <li>
                      This ZIP has {tree.length} files; the limit is {CONTRIBUTION_LIMITS.archiveEntries}.
                      Remove extra files or folders.
                    </li>
                  )}
                  {oversized.slice(0, 5).map((entry) => (
                    <li key={`large-${entry.path}`}>
                      {entry.path} is {formatBytes(entry.size)} unpacked; each file must be under{' '}
                      {formatBytes(CONTRIBUTION_LIMITS.archiveEntryBytes)}.
                    </li>
                  ))}
                  {tooMuchUnpacked && (
                    <li>
                      ZIP contents total {formatBytes(unpackedBytes)}; the limit is{' '}
                      {formatBytes(CONTRIBUTION_LIMITS.archiveUnpackedBytes)}. Largest files:{' '}
                      {largest.map((entry) => entry.path).join(', ')}.
                    </li>
                  )}
                  {oversized.length > 5 && <li>And {oversized.length - 5} more oversized files.</li>}
                </ul>
                {(tooMany || tooMuchUnpacked) && folders.length > 1 && (
                  <div className="mt-2">
                    <strong>Largest folders inside</strong> (zip these separately):
                    <ul className="m-0 mt-1 list-none p-0 font-mono text-[12px]">
                      {folders.map(([name, f]) => (
                        <li key={name} className="flex justify-between gap-3">
                          <span className="truncate" title={name}>
                            {name}/
                          </span>
                          <span className="whitespace-nowrap">
                            {f.files} files · {formatBytes(f.bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : l.wholeSubject ? (
              <>
                {' '}
                is a <strong className="text-teal-text">whole subject</strong>: syllabus, {l.units.length}{' '}
                unit{l.units.length === 1 ? '' : 's'}
                {l.pyqs ? ', past papers' : ''}. It can earn <strong>30% of every sale</strong>.
              </>
            ) : (
              <>
                {' '}
                is fine to send. To make it a whole subject (30% of every sale), add {l.missing.join(', ')}.
              </>
            )}
            {l.units.length > 0 && (
              <span className="block mt-1 text-[13px] text-ink2">
                Found: {l.syllabus ? 'Syllabus · ' : ''}
                {l.units.map((u) => u.name).join(' · ')}
                {l.pyqs ? ' · PYQs' : ''}
              </span>
            )}
            <details className="mt-2 rounded-lg bg-card/70 px-3 py-2" open={broken && tree.length <= 300}>
              <summary className="cursor-pointer font-semibold">
                Browse {tree.length} files in this ZIP
              </summary>
              <ul className="m-0 mt-2 max-h-56 overflow-auto list-none border-l border-line pl-3 font-mono text-[12px]">
                {tree.slice(0, 300).map((entry) => (
                  <li
                    key={entry.path}
                    className={`flex justify-between gap-3 py-0.5 ${tooBig.has(entry.path) ? 'text-blush-text font-semibold' : ''}`}
                    title={entry.path}
                  >
                    <span className="truncate">{entry.path}</span>
                    <span className="whitespace-nowrap text-ink2">{formatBytes(entry.size)}</span>
                  </li>
                ))}
                {tree.length > 300 && <li className="py-1 text-ink2">…and {tree.length - 300} more files</li>}
              </ul>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
