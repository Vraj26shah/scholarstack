/**
 * A remembered read: fresh for `freshMs`, then served as it is while one background read brings it
 * up to date (until `staleMs`, after which callers wait for the new read). Calls that arrive while
 * a read is running share it, so a busy page never sends the same query twenty times.
 */
export class Memo<T> {
  private value: T | undefined;
  private at = 0;
  private inflight: { promise: Promise<T>; at: number } | null = null;
  private generation = 0;

  constructor(
    private readonly load: () => Promise<T>,
    private readonly freshMs: number,
    private readonly staleMs: number,
  ) {}

  get(): Promise<T> {
    const age = Date.now() - this.at;
    if (this.value !== undefined && age < this.freshMs) return Promise.resolve(this.value);
    if (this.value !== undefined && age < this.staleMs) {
      // A background read can be cut off when a Worker finishes its response; never wait on it.
      this.refresh().catch(() => {});
      return Promise.resolve(this.value);
    }
    return this.refresh();
  }

  private refresh(): Promise<T> {
    // A read that never came back (its request was cancelled) is abandoned after 15 seconds.
    if (this.inflight && Date.now() - this.inflight.at < 15_000) return this.inflight.promise;
    const generation = this.generation;
    const promise = this.load().then(
      (value) => {
        if (generation === this.generation) {
          this.value = value;
          this.at = Date.now();
        }
        if (this.inflight?.promise === promise) this.inflight = null;
        return value;
      },
      (error) => {
        if (this.inflight?.promise === promise) this.inflight = null;
        throw error;
      },
    );
    this.inflight = { promise, at: Date.now() };
    return promise;
  }

  /** Forget the value (an admin changed something): the next caller waits for a fresh read. */
  forget() {
    this.generation++;
    this.value = undefined;
    this.at = 0;
    this.inflight = null;
  }
}

/** Memos by key (one per set of arguments), capped so it can't grow without limit. */
export class MemoMap<T> {
  private readonly memos = new Map<string, Memo<T>>();
  constructor(
    private readonly freshMs: number,
    private readonly staleMs: number,
    private readonly max = 200,
  ) {}
  get(key: string, load: () => Promise<T>): Promise<T> {
    let memo = this.memos.get(key);
    if (!memo) {
      if (this.memos.size >= this.max) this.memos.clear();
      memo = new Memo(load, this.freshMs, this.staleMs);
      this.memos.set(key, memo);
    }
    return memo.get();
  }
  forget() {
    this.memos.clear();
  }
}
