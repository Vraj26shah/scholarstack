import type { ConversionBoardDto, StorageEntryDto, StorageTreeDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { ChevronRight, Folder } from '../../shared/ui/icons';
import { type FileIssue, planUpload } from '../contribute/rules';
import { BranchPicker } from './branch-picker';
import {
  CAN_CANCEL,
  CAN_PAUSE,
  CAN_RESUME,
  CAN_START,
  CONVERSION_LABEL,
  CONVERSION_TONE,
  ConversionBar,
  conversionLine,
  conversionProgress,
} from './conversion-state';
import { DeleteSheet } from './delete-sheet';
import { ImportPanel } from './import-panel';
import { pickUpChanges } from './r2-file-sync';
import { MoveSheet, RenameSheet } from './storage-actions';
import { MoveFolderCard, bytes } from './storage-map-panel';
import { type TreeNode, buildTree } from './storage-tree';
import { Field, Panel, StatusPill, input, plural, rupeesToPaise } from './ui';
import { YearSelect } from './year-select';

/** What the server takes into a notes folder (see ADMIN_NOTES_POLICY): 40 MB a file, 95 MB a request. */
const ADMIN_UPLOAD = {
  extensions: ['pdf', 'ppt', 'pptx', 'pps', 'ppsx', 'odp', 'doc', 'docx', 'odt', 'txt', 'png', 'jpg', 'jpeg'],
  perFile: 40 * 1024 * 1024,
  perRequest: 90 * 1024 * 1024,
};

const KEY = ['admin', 'storage-tree'] as const;
const ROOT = 'drive-imports/';

/** Which files the folders show: all of them, or only ones clean-up can take. */
const SHOW = [
  ['all', 'Everything'],
  ['unused', 'Not used'],
  ['offline', 'Not on sale'],
] as const;
type Show = (typeof SHOW)[number][0];

/**
 * "Not used": in storage, but no course file points at it. "Not on sale": that, plus files of
 * draft or archived courses and hidden files, i.e. nothing a student can open right now.
 */
function showFilter(show: Show, data: StorageTreeDto) {
  if (show === 'all') return undefined;
  const live = new Set(data.courses.filter((c) => c.status === 'live').map((c) => c.id));
  return (e: StorageEntryDto) =>
    !e.key.endsWith('/') &&
    (e.state === 'unused' ||
      (show === 'offline' &&
        e.state === 'used' &&
        (e.hidden || !e.courseId || !live.has(e.courseId)) &&
        e.conversion !== 'pending'));
}

/** Every file (not folder) under a node. */
function filesUnder(n: TreeNode): TreeNode[] {
  return n.isFolder ? n.children.flatMap(filesUnder) : [n];
}

/** The folder at `path`, found in the tree. */
function find(root: TreeNode, path: string): TreeNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (!c.isFolder) continue;
    if (path.startsWith(c.path)) return find(c, path);
  }
  return null;
}

/** What a file is doing, in a few words — the same states and wording as Page jobs. */
function fileLine(n: TreeNode): { text: string; tone: string } {
  const e = n.entry;
  if (!e) return { text: '', tone: 'text-ink2' };
  if (e.state === 'missing') return { text: 'Gone from storage', tone: 'text-blush-text' };
  if (e.state === 'unused') return { text: 'Not on the site', tone: 'text-ink2' };
  const board = e.board ?? (e.conversion === 'ready' ? 'ready' : e.conversion === 'failed' ? 'failed' : null);
  const prefix = e.hidden ? 'Hidden · ' : '';
  if (board === 'ready' || (!board && e.conversion === 'ready')) {
    return { text: `${prefix}Ready · ${plural(e.pageCount ?? 0, 'page')}`, tone: 'text-teal-text' };
  }
  if (!board) return { text: `${prefix}Needs pages`, tone: 'text-marigold-text' };
  const detail =
    board === 'queued' && e.queueTotal
      ? `In line · ${e.queuePosition} of ${e.queueTotal}`
      : board === 'working' && e.total
        ? `Making · ${e.current} of ${e.total}`
        : board === 'failed' && e.error
          ? e.error.replace(/^Broken source:\s*/, '')
          : CONVERSION_LABEL[board];
  const tone =
    board === 'failed' || board === 'stalled'
      ? 'text-blush-text'
      : board === 'paused' || board === 'waiting'
        ? 'text-ink2'
        : 'text-marigold-text';
  return { text: `${prefix}${detail}`, tone };
}

/** Pages made / still to make for every course file under a folder. */
function folderPages(n: TreeNode) {
  let ready = 0;
  let total = 0;
  const visit = (x: TreeNode) => {
    if (!x.isFolder) {
      if (x.entry?.fileId && x.entry.state !== 'missing') {
        total++;
        if (x.entry.conversion === 'ready') ready++;
      }
      return;
    }
    x.children.forEach(visit);
  };
  visit(n);
  return { ready, total };
}

/**
 * Whether a folder can become a course, and if not, why. Any folder of notes inside the import
 * folder can, as long as no file ends up in two courses: not inside a course, not around one.
 */
export function courseability(
  node: TreeNode | null,
  courses: StorageTreeDto['courses'],
): { ok: true } | { ok: false; why: string } {
  if (!node?.isFolder) return { ok: false, why: 'Pick a folder.' };
  if (!node.path.startsWith(ROOT) || node.path === ROOT)
    return { ok: false, why: `Courses are made from folders inside ${ROOT}.` };
  if (courses.some((c) => c.r2Prefix === node.path))
    return { ok: false, why: 'This folder is already a course.' };
  const around = courses.find((c) => node.path.startsWith(c.r2Prefix));
  if (around)
    return { ok: false, why: `It is inside “${around.title}”, so it is already part of that course.` };
  const inside = courses.find((c) => c.r2Prefix.startsWith(node.path));
  if (inside)
    return { ok: false, why: `It holds the course “${inside.title}”. Open it and use the folders inside.` };
  if (node.files === 0) return { ok: false, why: 'It has no files yet. Upload notes first.' };
  return { ok: true };
}

/** Folders whose notes can be added to an existing course (moved in as a unit). */
export function attachable(node: TreeNode | null, courses: StorageTreeDto['courses']) {
  if (!node?.isFolder || node.files === 0 || !node.path.startsWith(ROOT) || node.path === ROOT) return false;
  if (courses.some((c) => node.path.startsWith(c.r2Prefix) || c.r2Prefix.startsWith(node.path))) return false;
  return courses.length > 0;
}

/** Make a course from a folder that isn't one yet: its sub-folders become units. */
function MakeCourseSheet({
  folder,
  onClose,
  onDone,
}: { folder: TreeNode; onClose: () => void; onDone: (folder: string) => void }) {
  const index = useQuery({ queryKey: ['catalogue'], queryFn: api.catalogue });
  const [f, setF] = useState({
    title: folder.name.replace(/\s*\(([A-Z]{2,5}\d{3,5}[A-Z]?)\)\s*$/, '').trim(),
    courseCode: /\(([A-Z]{2,5}\d{3,5}[A-Z]?)\)/.exec(folder.name)?.[1] ?? '',
    batchYear: /(\d{2}) Batch/.exec(folder.path)?.[1] ? `20${/(\d{2}) Batch/.exec(folder.path)![1]}` : '',
    branchSlugs: [] as string[],
    rupees: '99',
  });
  // Pre-tick the programmes whose official course list names this course code (once, when known).
  const [suggested, setSuggested] = useState(false);
  useEffect(() => {
    if (suggested || !index.data || f.branchSlugs.length || !f.courseCode) return;
    setSuggested(true);
    const slugs = index.data.branches.filter((b) => b.courseCodes.includes(f.courseCode)).map((b) => b.slug);
    if (slugs.length) setF((x) => ({ ...x, branchSlugs: slugs }));
  }, [index.data, f.courseCode, f.branchSlugs.length, suggested]);
  const make = useMutation({
    mutationFn: () =>
      api.adminImport([
        {
          prefix: folder.path,
          title: f.title.trim(),
          courseCode: f.courseCode.trim(),
          description: '',
          batchYear: Number(f.batchYear),
          branchSlugs: f.branchSlugs,
          // The server works out the semester from the folder path.
          pricePaise: rupeesToPaise(f.rupees),
        },
      ]),
    onSuccess: () => onDone(folder.path),
  });
  const ok =
    f.title.trim().length >= 2 &&
    /^\d{4}$/.test(f.batchYear) &&
    f.branchSlugs.length > 0 &&
    Number(f.rupees) >= 1;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Make this folder a course">
      <p className="m-0 font-mono text-[12px] text-ink2 break-all">{folder.path}</p>
      <p className="m-0 text-[14px] text-ink2">
        Sub-folders become units and pages start being made. It stays hidden until you publish it.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Title" className="sm:col-span-2">
          <input
            className={input}
            value={f.title}
            maxLength={120}
            onChange={(e) => setF({ ...f, title: e.target.value })}
          />
        </Field>
        <Field label="Course code">
          <input
            className={`${input} font-mono uppercase`}
            value={f.courseCode}
            maxLength={24}
            placeholder="e.g. CSE3001"
            onChange={(e) =>
              setF({ ...f, courseCode: e.target.value.toUpperCase().replace(/[^A-Z0-9._/-]/g, '') })
            }
          />
        </Field>
        <Field label="Price (₹)">
          <input
            className={`${input} font-mono`}
            value={f.rupees}
            inputMode="numeric"
            maxLength={5}
            onChange={(e) => setF({ ...f, rupees: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
        <Field label="Batch year">
          <YearSelect value={f.batchYear} onChange={(batchYear) => setF({ ...f, batchYear })} />
        </Field>
        <Field label="Branches" className="sm:col-span-2">
          <BranchPicker
            branches={index.data?.branches ?? []}
            selected={f.branchSlugs}
            onChange={(branchSlugs) => setF({ ...f, branchSlugs })}
            label="Branches for the new course"
          />
        </Field>
      </div>
      {make.isError && <p className="m-0 text-sm text-blush-text">{friendly(make.error)}</p>}
      <div className="flex gap-2">
        <Button disabled={!ok || make.isPending} onClick={() => make.mutate()}>
          {make.isPending ? 'Making the course…' : 'Make the course'}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Sheet>
  );
}

/** Pages being made under one folder only: totals, a bar, and every file that isn't done. */
function ScopeProgress({ path, onClose }: { path: string; onClose: () => void }) {
  const qc = useQueryClient();
  const board = useQuery({
    queryKey: ['admin', 'conversions-for', path],
    queryFn: () => api.adminConversionsFor([path]),
    refetchInterval: (q) => {
      const t = (q.state.data as ConversionBoardDto | undefined)?.totals;
      return t && t.queued + t.working + t.waiting > 0 ? 4_000 : false;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'conversions-for', path] });
  const start = useMutation({
    mutationFn: (f: { fileId: string; courseId: string }) =>
      api.adminConvert({ courseId: f.courseId, fileIds: [f.fileId], include: 'both' }),
    onSettled: refresh,
  });
  const pause = useMutation({
    mutationFn: (fileId: string) => api.adminPauseConversion([fileId]),
    onSettled: refresh,
  });
  const resume = useMutation({
    mutationFn: (fileId: string) => api.adminResumeConversion([fileId]),
    onSettled: refresh,
  });
  const cancel = useMutation({
    mutationFn: (fileId: string) => api.adminCancelConversion([fileId]),
    onSettled: refresh,
  });
  const busy = start.isPending || pause.isPending || resume.isPending || cancel.isPending;
  const t = board.data?.totals;
  const all = t ? t.ready + t.queued + t.working + t.waiting + t.paused + t.stalled + t.failed : 0;
  const open = (board.data?.files ?? []).filter((f) => f.state !== 'ready');
  return (
    <section aria-label="Pages for this folder" className="rounded-2xl bg-sunk p-4 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-auto">{path === ROOT ? 'Pages, all courses' : 'Pages for this folder'}</strong>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {board.isPending ? (
        <Skeleton className="h-10" />
      ) : board.isError ? (
        <p className="m-0 text-sm text-blush-text">{friendly(board.error)}</p>
      ) : t && all > 0 ? (
        <>
          <div
            className="h-2 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            tabIndex={0}
            aria-valuemin={0}
            aria-valuemax={all}
            aria-valuenow={t.ready}
            aria-label="Files with pages"
          >
            <div
              className="h-full rounded-full bg-teal transition-[width]"
              style={{ width: `${(t.ready / all) * 100}%` }}
            />
          </div>
          <p className="m-0 text-[13px] text-ink2">
            {t.ready} of {all} ready · {t.working} being made · {t.queued + t.waiting} waiting
            {t.paused ? ` · ${t.paused} paused` : ''}
            {t.stalled ? ` · ${t.stalled} stuck` : ''}
            {t.failed ? ` · ${t.failed} failed` : ''}
          </p>
          {open.length > 0 && (
            <ul className="m-0 p-0 list-none flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {open.map((f) => (
                <li key={f.fileId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                  <span className="truncate min-w-0 flex-1" title={f.sourceKey}>
                    {f.name}
                  </span>
                  <span
                    className={`inline-flex h-5 px-2 rounded-md text-[11px] font-semibold items-center ${CONVERSION_TONE[f.state]}`}
                  >
                    {CONVERSION_LABEL[f.state]}
                  </span>
                  <span className="text-ink2 truncate">{conversionLine(f)}</span>
                  {(f.state === 'working' || f.state === 'queued') && (
                    <span className="w-16 shrink-0">
                      <ConversionBar value={conversionProgress(f)} />
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1">
                    {CAN_START.includes(f.state) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => start.mutate({ fileId: f.fileId, courseId: f.courseId })}
                      >
                        Start
                      </Button>
                    )}
                    {CAN_PAUSE.includes(f.state) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => pause.mutate(f.fileId)}
                      >
                        Pause
                      </Button>
                    )}
                    {CAN_RESUME.includes(f.state) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => resume.mutate(f.fileId)}
                      >
                        Resume
                      </Button>
                    )}
                    {CAN_CANCEL.includes(f.state) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => cancel.mutate(f.fileId)}
                      >
                        Delete job
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="m-0 text-sm text-ink2">No course files in this folder yet.</p>
      )}
    </section>
  );
}

/**
 * Storage as folders you can open, like a drive: make folders, upload files, rename, move and
 * delete; turn a folder into a course; make pages for just this folder and watch them happen.
 * Every change updates the website too (a course's files, units and pages follow).
 */
export function FolderExplorer() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // Admins work inside the notes folder only; the rest of the bucket (pages, uploads, backups) is
  // the site's own and is looked after from Storage → Clean-up.
  const asked = params.get('folder') ?? ROOT;
  const path = asked.startsWith(ROOT) ? asked : ROOT;
  const go = (p: string) => {
    const next = new URLSearchParams(params);
    next.set('folder', p);
    setParams(next);
    setPicked(new Set());
    setPickMsg(null);
  };
  const tree = useQuery({ queryKey: KEY, queryFn: api.adminStorageTree });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<null | 'move' | 'rename' | 'delete' | 'course'>(null);
  // A folder picked from its row: make it a course, or add it to one.
  const [courseFor, setCourseFor] = useState<TreeNode | null>(null);
  const [addPaths, setAddPaths] = useState<string[] | null>(null);
  const show = (SHOW.find(([k]) => k === params.get('show'))?.[0] ?? 'all') as Show;
  const setShow = (v: Show) => {
    const next = new URLSearchParams(params);
    if (v === 'all') next.delete('show');
    else next.set('show', v);
    setParams(next);
    setPicked(new Set());
  };
  // A list of files to delete together ("every unused file here"), apart from ticked items.
  const [sweep, setSweep] = useState<{ paths: string[]; label: string } | null>(null);
  // Drag a file or folder onto a folder (or a step of the path) to move it there, like a drive.
  const [dropTo, setDropTo] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  // Opened from Today ("files students can't open"): show the pages list straight away.
  const [showPages, setShowPages] = useState(params.get('pages') === '1');
  const [bulk, setBulk] = useState(false);
  const [showCourseFolderMove, setShowCourseFolderMove] = useState(false);
  const [q, setQ] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => {
    for (const k of [
      KEY,
      ['admin-courses'],
      ['admin-units'],
      ['admin-inventory'],
      ['admin', 'conversions-for', path],
    ])
      void qc.invalidateQueries({ queryKey: k });
  };
  const mkdir = useMutation({
    // Outside the notes area (the bucket's top), new folders go into the notes area.
    mutationFn: (name: string) => api.adminCreateFolder(path.startsWith(ROOT) ? path : ROOT, name),
    onSuccess: () => {
      setNewFolder(null);
      refresh();
    },
  });
  const [skipped, setSkipped] = useState<FileIssue[]>([]);
  const upload = useMutation({
    // Files the server would refuse are named up front; the rest go in requests it accepts.
    mutationFn: async ({ files, replace }: { files: File[]; replace: boolean }) => {
      const plan = planUpload(files, ADMIN_UPLOAD);
      setSkipped(plan.skipped);
      const total = plan.batches.reduce((t, b) => t + b.reduce((s, f) => s + f.size, 0), 0) || 1;
      let sent = 0;
      let out: Awaited<ReturnType<typeof api.adminUploadToFolder>> | null = null;
      for (const batch of plan.batches) {
        const size = batch.reduce((t, f) => t + f.size, 0);
        const r = await api.adminUploadToFolder(path, batch, replace, (f) =>
          setUploadPct((sent + f * size) / total),
        );
        sent += size;
        out = out
          ? {
              ...r,
              keys: [...out.keys, ...r.keys],
              queued: out.queued + r.queued,
              problems: [...out.problems, ...r.problems],
            }
          : r;
      }
      return out;
    },
    onSettled: () => {
      setUploadPct(null);
      refresh();
    },
  });
  const [pickMsg, setPickMsg] = useState<string | null>(null);
  // Only what differs between storage and the site in this folder is touched: new, changed or
  // missing files, one request each. Untouched files keep their pages (nothing is re-made).
  const pickUp = useMutation({
    mutationFn: async () => {
      const { summary, outcomes, differences } = await pickUpChanges([path]);
      if (!differences) return 'Already up to date: storage and the site agree here.';
      const failed = outcomes.filter((o) => o.status === 'failed').length;
      return `Picked up: ${summary.filesAdded} new, ${summary.filesChanged} changed, ${summary.filesRetired} removed${
        summary.conversionQueued
          ? `; pages are being made for ${plural(summary.conversionQueued, 'file')}`
          : ''
      }.${failed ? ` ${failed} could not be updated, try again.` : ''}`;
    },
    onSuccess: (msg) => {
      setPickMsg(msg);
      setShowPages(true);
      refresh();
    },
    onError: (e) => setPickMsg(friendly(e)),
  });
  const convert = useMutation({
    mutationFn: () => api.adminConvertSelection([path], 'both'),
    onSuccess: () => {
      setShowPages(true);
      refresh();
    },
  });
  const syncR2 = useMutation({
    mutationFn: async () => {
      const result = await pickUpChanges(['']);
      if (!result.differences) return 'Already in sync: existing courses match the files in R2.';
      const { summary } = result;
      return `Synced from R2: ${plural(summary.filesAdded, 'file')} added, ${plural(summary.filesChanged, 'file')} changed, ${plural(summary.filesRetired, 'file')} removed${summary.conversionQueued ? `; pages are being made for ${plural(summary.conversionQueued, 'file')}` : ''}. New folders can be made into courses below.`;
    },
    onSuccess: (message) => {
      setPickMsg(message);
      setShowPages(true);
      refresh();
    },
    onError: (e) => setPickMsg(friendly(e)),
  });

  const root = useMemo(
    () => (tree.data ? buildTree(tree.data, showFilter(show, tree.data)) : null),
    [tree.data, show],
  );
  if (tree.isPending) return <Skeleton className="h-96" />;
  // Only an empty screen shows the error; a failed refresh keeps the folders you were looking at.
  if (tree.isError && !tree.data)
    return (
      <ErrorState
        title="Storage didn't load."
        message={friendly(tree.error)}
        onRetry={() => tree.refetch()}
      />
    );
  const data: StorageTreeDto = tree.data;
  const here = (root && find(root, path)) ?? null;
  const crumbs = [
    { name: 'All notes', path: ROOT },
    ...path
      .slice(ROOT.length)
      .split('/')
      .filter(Boolean)
      .map((part, i, all) => ({ name: part, path: `${ROOT}${all.slice(0, i + 1).join('/')}/` })),
  ];
  const inNotes = path.startsWith(ROOT);
  const shown = here && show !== 'all' ? filesUnder(here) : [];
  const shownBytes = shown.reduce((t, n) => t + n.bytes, 0);
  // Unused files outside any course are usually notes waiting to be made into a course.
  const waiting = shown.filter(
    (n) => n.entry?.state === 'unused' && !data.courses.some((c) => n.path.startsWith(c.r2Prefix)),
  ).length;
  const course = data.courses.find((c) => path.startsWith(c.r2Prefix));
  const isCourseRoot = course?.r2Prefix === path;
  const depth = path.split('/').filter(Boolean).length;
  // Any folder of notes can become a course, or be added to one, as long as no file ends up in two.
  const hereCourseable = courseability(here, data.courses);
  const canMakeCourse = hereCourseable.ok;
  const canAttachHere = attachable(here, data.courses);
  const children = [...(here?.children ?? [])].sort(
    (a, b) =>
      Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const pages = here ? folderPages(here) : { ready: 0, total: 0 };
  // Search across all storage: folders and files whose path has every word typed.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits: { path: string; name: string; isFolder: boolean; node: TreeNode }[] = [];
  const notesRoot = root ? find(root, ROOT) : null;
  if (words.length && notesRoot) {
    const visit = (n: TreeNode) => {
      for (const c of n.children) {
        const hay = c.path.toLowerCase();
        if (words.every((w) => hay.includes(w)) && hits.length < 60)
          hits.push({ path: c.path, name: c.name, isFolder: c.isFolder, node: c });
        if (c.isFolder) visit(c);
      }
    };
    visit(notesRoot);
  }
  const toggle = (p: string) =>
    setPicked((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  const one = picked.size === 1 ? [...picked][0]! : null;
  const selectedNode = one && root ? find(root, one) : null;
  const selectedCanMakeCourse = courseability(selectedNode, data.courses).ok;
  const closeSheet = () => {
    setSheet(null);
    setPicked(new Set());
    setDropTo(undefined);
  };
  const dropZone = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!dragging || dragging.some((d) => target.startsWith(d))) return;
      e.preventDefault();
      setOver(target);
    },
    onDragLeave: () => setOver((o) => (o === target ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      if (!dragging || dragging.some((d) => target.startsWith(d))) return;
      setPicked(new Set(dragging));
      setDropTo(target);
      setSheet('move');
      setDragging(null);
    },
  });
  const error = mkdir.error ?? upload.error ?? convert.error;

  return (
    <Panel
      title="Folders"
      aside={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="brand" size="sm" onClick={() => syncR2.mutate()} disabled={syncR2.isPending}>
            {syncR2.isPending ? 'Syncing R2…' : 'Sync from R2'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => tree.refetch()} disabled={tree.isFetching}>
            {tree.isFetching ? 'Reading storage…' : 'Refresh'}
          </Button>
        </div>
      }
    >
      <input
        type="search"
        aria-label="Find a folder or file"
        placeholder="Find a folder or file anywhere in storage…"
        className={`${input} w-full`}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {words.length > 0 && (
        <ul
          aria-label="Search results"
          className="m-0 p-0 list-none rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] divide-y divide-line max-h-80 overflow-y-auto"
        >
          {hits.map((h) => (
            <li key={h.path} className="flex items-center gap-3 px-4 py-2">
              <input
                type="checkbox"
                aria-label={`Tick ${h.path}`}
                checked={picked.has(h.path)}
                onChange={() => toggle(h.path)}
                className="accent-[var(--teal)]"
              />
              <button
                type="button"
                onClick={() => {
                  go(h.isFolder ? h.path : h.path.slice(0, h.path.lastIndexOf('/') + 1));
                  setQ('');
                }}
                className="flex-1 min-w-0 text-left bg-transparent border-0 p-0 cursor-pointer"
              >
                <span className="flex items-center gap-2 font-semibold text-ink truncate">
                  {h.isFolder && <Folder size={16} className="flex-none text-teal-text" />}
                  {h.name}
                </span>
                <span className="block font-mono text-[11px] text-ink2 truncate">{h.path}</span>
              </button>
              {!h.isFolder && (
                <span className={`text-[12px] ${fileLine(h.node).tone}`}>{fileLine(h.node).text}</span>
              )}
            </li>
          ))}
          {hits.length === 0 && <li className="px-4 py-3 text-ink2">Nothing matches.</li>}
        </ul>
      )}

      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1 text-[14px]">
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={14} className="text-ink2" />}
            {i === crumbs.length - 1 ? (
              <strong>{c.name}</strong>
            ) : (
              <button
                type="button"
                onClick={() => go(c.path)}
                {...dropZone(c.path)}
                className={`text-teal-text font-semibold border-0 p-0 cursor-pointer underline rounded ${over === c.path ? 'bg-mist' : 'bg-transparent'}`}
              >
                {c.name}
              </button>
            )}
          </span>
        ))}
        {course && (
          <span className="ml-2 inline-flex items-center gap-1.5 text-[13px] text-ink2">
            <StatusPill status={course.status} /> {isCourseRoot ? 'This folder is the course' : 'Inside'}{' '}
            <a
              href={`/admin?section=courses&course=${course.id}`}
              onClick={(e) => {
                e.preventDefault();
                setParams({ section: 'courses', course: course.id });
              }}
              className="font-semibold text-teal-text"
            >
              {course.title}
            </a>
          </span>
        )}
        {isCourseRoot && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setParams({ section: 'courses', course: course.id, tab: 'details' })}
            >
              Rename course
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowCourseFolderMove((v) => !v)}>
              {showCourseFolderMove ? 'Close folder editor' : 'Rename or move course folder'}
            </Button>
          </div>
        )}
      </nav>
      {showCourseFolderMove && isCourseRoot && course && (
        <MoveFolderCard
          courseId={course.id}
          onMoved={(newFolder) => {
            refresh();
            if (newFolder) go(newFolder);
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Show">
        {SHOW.map(([k, label]) => (
          <Button key={k} size="sm" variant={show === k ? 'brand' : 'outline'} onClick={() => setShow(k)}>
            {label}
          </Button>
        ))}
      </div>
      {show !== 'all' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-sunk px-4 py-3">
          <span className="text-[14px] mr-auto">
            {shown.length ? (
              <>
                <strong className="tabular-nums">{plural(shown.length, 'file')}</strong> ({bytes(shownBytes)}){' '}
                {show === 'unused'
                  ? 'here that no course uses.'
                  : 'here that no student can open (not used, hidden, or in a course that isn’t live).'}{' '}
                Folders show only these files.
                {waiting > 0 && (
                  <span className="block mt-1 text-[13px] text-ink2">
                    {plural(waiting, 'file')} {waiting === 1 ? 'is' : 'are'} in folders that aren't a course
                    yet. If {waiting === 1 ? 'it is' : 'they are'} new notes, make the folder a course instead
                    of deleting.
                  </span>
                )}
              </>
            ) : show === 'unused' ? (
              'Nothing unused here.'
            ) : (
              'Everything here is on sale.'
            )}
          </span>
          {shown.length > 0 && (
            <Button
              size="sm"
              variant="ink"
              onClick={() =>
                setSweep({
                  paths: shown.map((n) => n.path),
                  label: `${plural(shown.length, 'file')} ${show === 'unused' ? 'not used' : 'not on sale'} in ${here?.path || 'all of storage'}`,
                })
              }
            >
              Delete all {shown.length}…
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setNewFolder('')}>
          New folder
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={upload.isPending || path === ROOT || !inNotes}
        >
          {upload.isPending ? `Uploading ${Math.round((uploadPct ?? 0) * 100)}%…` : 'Upload files'}
        </Button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          accept={ADMIN_UPLOAD.extensions.map((e) => `.${e}`).join(',')}
          aria-label="Files to upload"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) upload.mutate({ files, replace: false });
          }}
        />
        {pages.total > 0 && pages.ready < pages.total && (
          <Button size="sm" variant="outline" onClick={() => convert.mutate()} disabled={convert.isPending}>
            Make pages here ({pages.total - pages.ready})
          </Button>
        )}
        {pages.total > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowPages(!showPages)}
            aria-expanded={showPages}
          >
            {pages.ready < pages.total ? `Pages ${pages.ready}/${pages.total}` : 'Pages: all ready'}
          </Button>
        )}
        {course && (
          <Button size="sm" variant="outline" onClick={() => pickUp.mutate()} disabled={pickUp.isPending}>
            {pickUp.isPending ? 'Checking storage…' : 'Pick up changes'}
          </Button>
        )}
        {canMakeCourse && (
          <Button size="sm" onClick={() => setSheet('course')}>
            Make this folder a course
          </Button>
        )}
        {canAttachHere && (
          <Button size="sm" variant="outline" onClick={() => setAddPaths([path])}>
            Add this folder to a course…
          </Button>
        )}
        {!course && (
          <Button size="sm" variant="ghost" onClick={() => setBulk(!bulk)} aria-expanded={bulk}>
            {bulk ? 'Close' : 'Make several courses at once'}
          </Button>
        )}
        <span className="ml-auto text-[13px] text-ink2">
          {here
            ? `${plural(here.files, 'file')} · ${bytes(here.bytes)}${here.unused ? ` · ${here.unused} not on the site` : ''}`
            : ''}
        </span>
      </div>

      {path === ROOT && (
        <p className="m-0 text-[13px] text-ink2 basis-full">
          Open a batch folder (or make one, e.g. “27 Batch”), then a subject, then upload.
        </p>
      )}
      {newFolder !== null && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newFolder.trim()) mkdir.mutate(newFolder.trim());
          }}
        >
          <Field
            label={
              depth >= 3
                ? 'New module (unit) folder'
                : depth === 2
                  ? 'New subject folder (can become a course)'
                  : 'New batch folder'
            }
            className="w-80"
          >
            <input
              aria-label="New folder name"
              className={input}
              value={newFolder}
              maxLength={120}
              placeholder={
                depth >= 3
                  ? 'e.g. Module 2 - SQL'
                  : depth === 2
                    ? 'e.g. Database Systems (CSE3001)'
                    : 'e.g. 27 Batch'
              }
              onChange={(e) => setNewFolder(e.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" disabled={!newFolder.trim() || mkdir.isPending}>
            Make folder
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNewFolder(null)}>
            Cancel
          </Button>
        </form>
      )}
      {skipped.length > 0 && !upload.isPending && (
        <div role="alert" className="rounded-xl bg-blush/50 px-4 py-3 text-[13px] text-blush-text">
          <strong>{plural(skipped.length, 'file')} not uploaded</strong>
          <ul className="m-0 mt-1 pl-5 list-disc">
            {skipped.map((f) => (
              <li key={`${f.name}|${f.size}`} className="[overflow-wrap:anywhere]">
                <span className="font-semibold">{f.name}</span>: {f.why}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="mt-1 font-semibold underline underline-offset-4"
            onClick={() => setSkipped([])}
          >
            Dismiss
          </button>
        </div>
      )}
      {upload.data && (
        <p className="m-0 text-sm text-teal-text" role="status">
          Uploaded {plural(upload.data.keys.length, 'file')}
          {upload.data.courseTitle
            ? ` to ${upload.data.courseTitle}; ${plural(upload.data.queued, 'file')} sent to be made into pages.`
            : '. This folder isn’t a course yet, so they aren’t on the site.'}
          {upload.data.problems.length > 0 && (
            <span className="text-blush-text"> {upload.data.problems.join(' ')}</span>
          )}
        </p>
      )}
      {upload.isError && /already in this folder/.test(friendly(upload.error)) && (
        <p className="m-0 text-sm">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const files = upload.variables?.files ?? [];
              if (files.length) upload.mutate({ files, replace: true });
            }}
          >
            Replace the old copy
          </Button>
        </p>
      )}
      {error && <p className="m-0 text-sm text-blush-text">{friendly(error)}</p>}
      {convert.data && (
        <p className="m-0 text-sm text-teal-text" role="status">
          {convert.data.queued
            ? `${plural(convert.data.queued, 'file')} sent to be made into pages.`
            : 'Nothing here needed pages.'}
          {convert.data.skipped.length > 0 && ` ${convert.data.skipped.join(' ')}`}
        </p>
      )}
      {syncR2.isError && <p className="m-0 text-sm text-blush-text">{friendly(syncR2.error)}</p>}
      {bulk && <ImportPanel />}
      {pickMsg && (
        <p role="status" className="m-0 text-sm text-ink2">
          {pickMsg}
        </p>
      )}
      {showPages && <ScopeProgress path={path} onClose={() => setShowPages(false)} />}

      {picked.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-ink text-bg px-4 py-2.5">
          <span className="mr-auto text-[14px] font-semibold">{plural(picked.size, 'item')} ticked</span>
          {one && (
            <Button size="sm" variant="mist" onClick={() => setSheet('rename')}>
              Rename
            </Button>
          )}
          {selectedCanMakeCourse && (
            <Button size="sm" variant="buy" onClick={() => setSheet('course')}>
              Make selected folder a course
            </Button>
          )}
          <Button size="sm" variant="mist" onClick={() => setSheet('move')}>
            {[...picked].some((p) => data.courses.some((c) => p.startsWith(c.r2Prefix)))
              ? 'Move to…'
              : 'Add to a course…'}
          </Button>
          <Button size="sm" variant="mist" onClick={() => setSheet('delete')}>
            Delete
          </Button>
          <Button size="sm" variant="outline-light" onClick={() => setPicked(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <ul className="m-0 p-0 list-none rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] divide-y divide-line overflow-hidden">
        {children.length > 1 && (
          <li className="flex items-center gap-3 px-4 py-2 bg-sunk/60 text-[13px] text-ink2">
            <input
              type="checkbox"
              aria-label="Tick everything in this folder"
              checked={children.every((n) => picked.has(n.path))}
              onChange={(e) => setPicked(e.target.checked ? new Set(children.map((n) => n.path)) : new Set())}
              className="accent-[var(--teal)]"
            />
            <span>Tick all {children.length}</span>
          </li>
        )}
        {children.map((n) => {
          const line = n.isFolder ? null : fileLine(n);
          const p = n.isFolder ? folderPages(n) : null;
          const c = n.isFolder ? data.courses.find((x) => x.r2Prefix === n.path) : null;
          return (
            <li
              key={n.path}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragging(picked.has(n.path) ? [...picked] : [n.path]);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
              {...(n.isFolder ? dropZone(n.path) : {})}
              className={`flex items-center gap-3 px-4 py-2.5 ${over === n.path ? 'bg-mist' : ''}`}
            >
              <input
                type="checkbox"
                aria-label={`Tick ${n.name}`}
                checked={picked.has(n.path)}
                onChange={() => toggle(n.path)}
                className="accent-[var(--teal)]"
              />
              {n.isFolder ? (
                <button
                  type="button"
                  onClick={() => go(n.path)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 text-left bg-transparent border-0 p-0 cursor-pointer"
                >
                  <Folder size={18} className="flex-none text-teal-text" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{n.name}</span>
                    <span className="block text-[12px] text-ink2">
                      {plural(n.files, 'file')} · {bytes(n.bytes)}
                      {p && p.total > 0 && ` · pages ${p.ready}/${p.total}`}
                      {n.unused > 0 && ` · ${n.unused} not on the site`}
                      {n.missing > 0 && (
                        <span className="text-blush-text"> · {n.missing} gone from storage</span>
                      )}
                    </span>
                  </span>
                  {c && (
                    <span className="ml-auto flex-none inline-flex items-center gap-1.5 text-[12px] text-ink2">
                      <StatusPill status={c.status} /> course
                    </span>
                  )}
                </button>
              ) : (
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[14px]" title={n.path}>
                    {n.name}
                  </span>
                  <span className={`block text-[12px] ${line?.tone ?? ''}`}>
                    {bytes(n.bytes)} · {line?.text}
                  </span>
                </span>
              )}
              {n.isFolder && !c && (courseability(n, data.courses).ok || attachable(n, data.courses)) && (
                <span className="flex flex-none items-center gap-1.5">
                  {courseability(n, data.courses).ok && (
                    <Button size="sm" variant="outline" onClick={() => setCourseFor(n)}>
                      Make course
                    </Button>
                  )}
                  {attachable(n, data.courses) && (
                    <Button size="sm" variant="ghost" onClick={() => setAddPaths([n.path])}>
                      Add to course
                    </Button>
                  )}
                </span>
              )}
            </li>
          );
        })}
        {children.length === 0 && (
          <li className="px-4 py-6 text-center text-ink2">
            {show === 'all'
              ? 'This folder is empty. Upload files or make a folder.'
              : 'Nothing to clean up in this folder.'}
          </li>
        )}
      </ul>

      {sheet === 'move' && <MoveSheet paths={[...picked]} data={data} onClose={closeSheet} to={dropTo} />}
      {sheet === 'rename' && one && <RenameSheet path={one} onClose={closeSheet} />}
      {sheet === 'delete' && picked.size > 0 && <DeleteSheet paths={[...picked]} onClose={closeSheet} />}
      {sweep && <DeleteSheet paths={sweep.paths} label={sweep.label} onClose={() => setSweep(null)} />}
      {(courseFor ||
        (sheet === 'course' && (selectedCanMakeCourse ? selectedNode : canMakeCourse ? here : null))) && (
        <MakeCourseSheet
          folder={(courseFor ?? (selectedCanMakeCourse ? selectedNode : here))!}
          onClose={() => {
            setSheet(null);
            setCourseFor(null);
          }}
          onDone={(made) => {
            setSheet(null);
            setCourseFor(null);
            setPicked(new Set());
            refresh();
            // Open the new course's folder so its pages can be watched being made.
            go(made);
            setShowPages(true);
          }}
        />
      )}
      {addPaths && (
        <MoveSheet
          paths={addPaths}
          data={data}
          onClose={() => setAddPaths(null)}
          onMoved={(to) => {
            refresh();
            // The folder you were in has moved: follow it.
            if (addPaths.includes(path)) go(to);
            setShowPages(true);
          }}
        />
      )}
    </Panel>
  );
}
