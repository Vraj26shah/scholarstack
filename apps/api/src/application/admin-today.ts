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

/**
 * What needs the admin now. Every count is read on its own, so one slow or failing part shows as
 * "couldn't check" instead of hiding the rest.
 */
export async function todaySummary(sources: TodaySources, now = new Date()): Promise<AdminTodayDto> {
  const items = await Promise.all(
    ORDER.map(async (key): Promise<TodayItemDto> => {
      try {
        const v = await sources[key]();
        return typeof v === 'number'
          ? { key, count: v }
          : { key, count: v.count, amountPaise: v.amountPaise };
      } catch (e) {
        console.error(
          JSON.stringify({ level: 'warn', event: 'admin.today', key, error: (e as Error).message }),
        );
        return { key, count: null };
      }
    }),
  );
  return { checkedAt: now.toISOString(), items };
}

/** Problems seen in the last day. */
export const recentProblems = (list: { lastAt: string }[], now = new Date()) =>
  list.filter((p) => now.getTime() - new Date(p.lastAt).getTime() < 86_400_000).length;
