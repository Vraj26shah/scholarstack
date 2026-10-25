import type { StorageEntryDto, StorageTreeDto } from '@ss/contracts';

/** A folder or a file in the tree, with sizes and counts rolled up from below. */
export interface TreeNode {
  name: string;
  /** Full path; folders end with "/". */
  path: string;
  isFolder: boolean;
  entry: StorageEntryDto | null;
  children: TreeNode[];
  files: number;
  bytes: number;
  pageBytes: number;
  unused: number;
  missing: number;
  /** The course whose folder this is, if any. */
  course: StorageTreeDto['courses'][number] | null;
}

/** Turn the flat list of R2 keys into folders and files. Pure, so it's easy to test. */
export function buildTree(
  data: StorageTreeDto,
  filter: (e: StorageEntryDto) => boolean = () => true,
): TreeNode {
  const root: TreeNode = node('R2', '', true);
  const byPrefix = new Map(data.courses.map((c) => [c.r2Prefix, c]));
  for (const e of data.entries) {
    if (!filter(e)) continue;
    const parts = e.key.split('/');
    let at = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = `${parts.slice(0, i + 1).join('/')}/`;
      let child = at.children.find((c) => c.isFolder && c.path === path);
      if (!child) {
        child = node(parts[i]!, path, true);
        child.course = byPrefix.get(path) ?? null;
        at.children.push(child);
      }
      at = child;
    }
    const leaf = node(parts.at(-1)!, e.key, false);
    leaf.entry = e;
    at.children.push(leaf);
  }
  roll(root);
  return root;
}

function node(name: string, path: string, isFolder: boolean): TreeNode {
  return {
    name,
    path,
    isFolder,
    entry: null,
    children: [],
    files: 0,
    bytes: 0,
    pageBytes: 0,
    unused: 0,
    missing: 0,
    course: null,
  };
}

function roll(n: TreeNode) {
  if (!n.isFolder && n.entry) {
    n.files = 1;
    n.bytes = n.entry.size;
    n.pageBytes = n.entry.pageBytes;
    n.unused = n.entry.state === 'unused' ? 1 : 0;
    n.missing = n.entry.state === 'missing' ? 1 : 0;
    return;
  }
  for (const c of n.children) {
    roll(c);
    n.files += c.files;
    n.bytes += c.bytes;
    n.pageBytes += c.pageBytes;
    n.unused += c.unused;
    n.missing += c.missing;
  }
  n.children.sort(
    (a, b) =>
      Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}
