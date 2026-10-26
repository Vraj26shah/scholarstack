import type { ContributionPipelineDto, FiledFileDto, MyContributionDto, PipelineStep } from '@ss/contracts';
import type { Contribution, Course, CourseFile } from '../../domain/entities';

/** Where the course's copy of each filed key stands. */
export function filedFiles(c: Contribution, courseFiles: CourseFile[]): FiledFileDto[] {
  const byKey = new Map(courseFiles.map((f) => [f.sourceKey, f]));
  return (c.filed?.keys ?? []).map((key) => {
    const f = byKey.get(key);
    const name = key.split('/').pop() ?? key;
    if (!f || f.sourceMissingAt) return { key, name, status: 'missing', pages: 0 };
    if (f.hidden || f.unitHidden) return { key, name: f.name, status: 'hidden', pages: f.pageCount };
    if (f.conversionStatus === 'ready' && f.pageCount > 0)
      return { key, name: f.name, status: 'ready', pages: f.pageCount };
    if (f.conversionStatus === 'failed') return { key, name: f.name, status: 'failed', pages: 0 };
    return {
      key,
      name: f.name,
      status: f.conversionStage || f.conversionQueueId ? 'working' : 'waiting',
      pages: 0,
    };
  });
}

const rewarded = (c: Contribution) => c.reward !== null && c.reward.type !== 'none';

/**
 * The next thing to do, in order: decide → file → reward → pages → finish (all done, waiting
 * for the admin's tick) → done. Rewards and pages run side by side; the step shows the first gap.
 */
export function stepOf(c: Contribution, files: FiledFileDto[]): PipelineStep {
  if (c.status === 'rejected') return 'rejected';
  if (c.completedAt) return 'done';
  if (c.status === 'pending') return 'decide';
  if (!c.filed) return 'file';
  if (!rewarded(c)) return 'reward';
  const shown = files.filter((f) => f.status !== 'hidden' && f.status !== 'missing');
  if (shown.length === 0 || shown.some((f) => f.status !== 'ready')) return 'pages';
  return 'finish';
}

export function pipelineOf(
  c: Contribution,
  course: Course | null,
  courseFiles: CourseFile[],
): ContributionPipelineDto {
  const files = filedFiles(c, courseFiles);
  return {
    step: stepOf(c, files),
    filed:
      c.filed && course
        ? {
            courseId: course.id,
            courseTitle: course.title,
            courseSlug: course.slug,
            courseStatus: course.status,
            folder: c.filed.folder,
            at: c.filed.at.toISOString(),
            files,
          }
        : null,
    completedAt: c.completedAt?.toISOString() ?? null,
  };
}

/** The student's view: in review → accepted → in a course → live (some of it readable, on sale). */
export function progressOf(
  c: Contribution,
  course: Course | null,
  courseFiles: CourseFile[],
): MyContributionDto['progress'] {
  if (c.status === 'rejected') return { step: 'rejected', courseTitle: null, courseSlug: null };
  if (c.status === 'pending') return { step: 'review', courseTitle: null, courseSlug: null };
  if (!c.filed || !course) return { step: 'accepted', courseTitle: null, courseSlug: null };
  const live = course.status === 'live' && filedFiles(c, courseFiles).some((f) => f.status === 'ready');
  return { step: live ? 'live' : 'filed', courseTitle: course.title, courseSlug: course.slug };
}

/** Looks up, in two calls, the courses and files that a list of contributions was filed into. */
export class FiledCourses {
  constructor(
    private readonly courses: { coursesByIds(ids: string[]): Promise<Course[]> },
    private readonly files: { listAllFiles(courseIds: string[]): Promise<CourseFile[]> },
  ) {}

  async load(list: Contribution[]) {
    const ids = [...new Set(list.map((c) => c.filed?.courseId).filter((x): x is string => !!x))];
    const [courses, files] = ids.length
      ? await Promise.all([this.courses.coursesByIds(ids), this.files.listAllFiles(ids)])
      : [[], []];
    const course = new Map(courses.map((x) => [x.id, x]));
    return {
      course: (c: Contribution) => (c.filed ? (course.get(c.filed.courseId) ?? null) : null),
      files: (c: Contribution) => (c.filed ? files.filter((f) => f.courseId === c.filed!.courseId) : []),
    };
  }
}
