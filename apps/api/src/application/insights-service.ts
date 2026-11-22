import type {
  AdminActivityDto,
  AdminInsightsDto,
  StudentActivityDto,
  TrackHitBody,
  TrackViewBody,
} from '@ss/contracts';
import type { InsightsRepository } from '../domain/ports';
import { activityTarget } from './activity';

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

  /**
   * A page opened or an action, by a signed-in student (their own row) or a visitor (counted with
   * all visitors, never told apart). Admins are not counted. Never fails the page.
   */
  async recordHit(viewer: { userId: string; isAdmin: boolean } | null, body: TrackHitBody): Promise<void> {
    if (viewer?.isAdmin) return;
    const hit = activityTarget(body);
    if (!hit) return;
    try {
      await this.repo.recordActivity(viewer?.userId ?? null, hit.kind, hit.target);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'warn',
          event: 'insights.hit',
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }

  async activity(days: AdminActivityDto['days']): Promise<AdminActivityDto> {
    const now = this.now();
    const data = await this.repo.activity(periodStart(Number(days), now), 30);
    return { days, checkedAt: now.toISOString(), ...data };
  }

  people() {
    return this.repo.people();
  }

  studentActivity(userId: string, days: number): Promise<StudentActivityDto> {
    return this.repo.studentActivity(userId, periodStart(days, this.now()));
  }

  async report(days: AdminInsightsDto['days']): Promise<AdminInsightsDto> {
    const now = this.now();
    const data = await this.repo.report(periodStart(Number(days), now), TOP);
    return { days, checkedAt: now.toISOString(), ...data };
  }
}
