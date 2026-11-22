import type { AdminTodayDto, TodayItemDto, TodayKey } from '@ss/contracts';

/** Each count the "Today" screen shows, read from the service that already owns it. */
export interface TodaySources {
  questions: () => Promise<number>;
  uploads: () => Promise<number>;
  publish: () => Promise<number>;
  files: () => Promise<number>;
  rewards: () => Promise<{ count: number; amountPaise: number }>;
  emails: () => Promise<number>;
  problems: () => Promise<number>;
}

const ORDER: TodayKey[] = ['questions', 'uploads', 'publish', 'files', 'rewards', 'emails', 'problems'];

export interface TodayOptions {
  /** A part slower than this shows as "couldn't check" instead of holding up the screen. */
  timeoutMs?: number;
  /** A part slower than this is logged with its time, so a slow screen names its cause. */
  slowMs?: number;
  /** Told about each part that ran out of time (the Worker sends it to Sentry). */
  onTimeout?: (key: TodayKey, ms: number) => void;
}

class TimedOut extends Error {}

/**
 * What needs the admin now. Every count is read on its own, so one slow or failing part shows as
 * "couldn't check" instead of hiding the rest, and none can keep the screen waiting: this screen
 * once took up to 43 s, and the Worker gave up (503) when several admin tabs asked at once.
 */
export async function todaySummary(
  sources: TodaySources,
  now = new Date(),
  { timeoutMs = 6_000, slowMs = 2_000, onTimeout }: TodayOptions = {},
): Promise<AdminTodayDto> {
  const timings: Partial<Record<TodayKey, number>> = {};
  const items = await Promise.all(
    ORDER.map(async (key): Promise<TodayItemDto> => {
      const t0 = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const v = await Promise.race([
          sources[key](),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new TimedOut()), timeoutMs);
          }),
        ]);
        timings[key] = Date.now() - t0;
        return typeof v === 'number'
          ? { key, count: v }
          : { key, count: v.count, amountPaise: v.amountPaise };
      } catch (e) {
        const ms = Date.now() - t0;
        timings[key] = ms;
        if (e instanceof TimedOut) onTimeout?.(key, ms);
        console.error(
          JSON.stringify({
            level: 'warn',
            event: 'admin.today',
            key,
            ms,
            error: e instanceof TimedOut ? `no answer in ${timeoutMs} ms` : (e as Error).message,
          }),
        );
        return { key, count: null };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  if (Object.values(timings).some((ms) => (ms ?? 0) >= slowMs))
    console.warn(JSON.stringify({ level: 'warn', event: 'admin.today.slow', timings }));
  return { checkedAt: now.toISOString(), items };
}

/** Problems still on the list: the count stays until the admin clears them, like any other task. */
export const openProblems = (list: unknown[]) => list.length;
