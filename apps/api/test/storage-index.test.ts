import { describe, expect, it } from 'vitest';
import { StorageIndex } from '../src/application/storage-index';
import { MemoryObjectStore } from '../src/infrastructure/memory';

/** A bucket that counts how often its page tiles are listed. */
function bucket() {
  const store = new MemoryObjectStore();
  const bytes = new Uint8Array(10);
  for (let i = 0; i < 5; i++) store.put(`pages/file-a/${i}.webp`, bytes, 'image/webp');
  store.put('drive-imports/23 Batch/DBMS/Unit 1/notes.pdf', bytes, 'application/pdf');
  let pageLists = 0;
  const listPage = store.listPage.bind(store);
  store.listPage = async (prefix: string, cursor?: string, limit?: number) => {
    if (prefix === 'pages/') pageLists++;
    return listPage(prefix, cursor, limit);
  };
  return { store, bytes, pageLists: () => pageLists };
}

describe('storage index', () => {
  it('keeps answering from the last page count after an admin change, and refreshes it in the background', async () => {
    const { store, bytes, pageLists } = bucket();
    let now = 1_000;
    const index = new StorageIndex(store, store, 60_000, () => now);

    expect((await index.pageStats()).get('file-a')?.objects).toBe(5);
    expect(pageLists()).toBe(1);

    // An admin change (rename, publish, delete an email…) used to throw everything away, so the
    // very next screen walked tens of thousands of tiles again. Now it answers at once…
    store.put('pages/file-a/5.webp', bytes, 'image/webp');
    index.forget();
    now += 1_000;
    expect((await index.pageStats()).get('file-a')?.objects).toBe(5);
    // …while one background read catches up, shared by everyone asking meanwhile.
    await new Promise((r) => setTimeout(r, 0));
    expect(pageLists()).toBe(2);
    expect((await index.pageStats()).get('file-a')?.objects).toBe(6);
    expect(pageLists()).toBe(2);
  });

  it('counts again before a delete or move acts, and when the count is too old to trust', async () => {
    const { store, pageLists } = bucket();
    let now = 0;
    const index = new StorageIndex(store, store, 60_000, () => now);
    await index.pageStats();
    await index.pageStats(true);
    expect(pageLists()).toBe(2);
    now += 11 * 60_000;
    await index.pageStats();
    expect(pageLists()).toBe(3);
  });

  it('re-reads the notes right after an admin change, so a new upload shows straight away', async () => {
    const { store, bytes } = bucket();
    const index = new StorageIndex(store, store, 60_000, () => 0);
    expect((await index.notes()).length).toBe(1);
    store.put('drive-imports/23 Batch/DBMS/Unit 1/more.pdf', bytes, 'application/pdf');
    expect((await index.notes()).length).toBe(1);
    index.forget();
    expect((await index.notes()).length).toBe(2);
  });
});
