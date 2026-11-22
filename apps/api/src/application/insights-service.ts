import type { AdminInsightsDto, TrackViewBody } from '@ss/contracts';
import type { InsightsRepository } from '../domain/ports';

const DAY = 24 * 60 * 60 * 1000;
const IST = 5.5 * 60 * 60 * 1000;
const TOP = 15;

/** Midnight IST, `days - 1` days before today: "7 days" is today and the six before it. */
export function periodStart(days: number, now: Date): Date {
  const istMidnight = Math.floor((now.getTime() + IST) / DAY) * DAY - IST;
  return new Date(istMidnight - (days - 1) * DAY);
}

/**
 * Admin › Students › Insights: what students open and how that turns into buying, from our own
 * database (no third-party script, no personal data in the view counts).
 */
export class InsightsService {
  constructor(
    private readonly repo: InsightsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** A page view. Never fails the page: a counter hiccup is only logged. */
  async recordView(body: TrackViewBody): Promise<void> {
    const item = 'courseId' in body ? { courseId: body.courseId } : { bundleId: body.bundleId };
    try {
      await this.repo.recordView(item, body.signedIn);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'warn',
          event: 'insights.view',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async report(days: AdminInsightsDto['days']): Promise<AdminInsightsDto> {
    const now = this.now();
    const data = await this.repo.report(periodStart(Number(days), now), TOP);
    return { days, checkedAt: now.toISOString(), ...data };
  }
}
