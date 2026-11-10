import type { StoredFile } from '../../domain/entities';
import type { UploadStore } from '../../domain/ports';
import { fail } from '../errors';
import { CONTRIBUTION_POLICY, type UploadPolicy, checkFile } from './file-policy';

export interface IncomingFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Check every file first (all or nothing), then store them under `prefix`. If storing any file
 * fails, the ones already stored are deleted again, so nothing is left behind.
 */
export async function storeFiles(
  uploads: UploadStore,
  prefix: string,
  files: IncomingFile[],
  policy: UploadPolicy = CONTRIBUTION_POLICY,
): Promise<StoredFile[]> {
  const checked = files.map((f) => ({ f, check: checkFile(f.name, f.bytes, policy) }));
  for (const c of checked) if (!c.check.ok) throw fail.badRequest(c.check.reason);
  const stored: StoredFile[] = [];
  try {
    for (const [i, { f, check }] of checked.entries()) {
      if (!check.ok) continue;
      const key = `${prefix}${i + 1}-${check.name}`;
      await uploads.save(key, f.bytes, check.contentType);
      stored.push({ index: i + 1, key, name: check.name, size: f.bytes.byteLength, type: check.contentType });
    }
    return stored;
  } catch (error) {
    await deleteFiles(uploads, stored);
    throw error;
  }
}

export async function deleteFiles(uploads: UploadStore, files: Pick<StoredFile, 'key'>[]) {
  for (const f of files) await uploads.delete(f.key).catch(() => {});
}
