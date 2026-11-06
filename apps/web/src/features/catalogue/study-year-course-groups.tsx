import type { CourseCardDto } from '@ss/contracts';
import { studyYearFromSemester } from '@ss/contracts';
import { IndexCard } from '../../shared/ui/index-card';

/** Split a batch/branch drawer by the year indicated by each course's semester. */
export function StudyYearCourseGroups({
  courses,
  animate = true,
}: {
  courses: CourseCardDto[];
  animate?: boolean;
}) {
  const groups = new Map<number | null, CourseCardDto[]>();
  for (const course of courses) {
    const year = studyYearFromSemester(course.semester);
    groups.set(year, [...(groups.get(year) ?? []), course]);
  }
  const ordered = [...groups.entries()].sort(
    ([a], [b]) => (a ?? Number.MAX_SAFE_INTEGER) - (b ?? Number.MAX_SAFE_INTEGER),
  );
  let cardIndex = 0;

  return (
    <div className="flex flex-col gap-8">
      {ordered.map(([year, items]) => {
        const start = cardIndex;
        cardIndex += items.length;
        const semesterStart = year == null ? null : year * 2 - 1;
        return (
          <section
            key={year ?? 'unassigned'}
            aria-label={year == null ? 'Study year not set' : `Study year ${year}`}
            className="flex flex-col gap-4"
          >
            {ordered.length > 1 && (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
                <h3 className="m-0 font-display font-extrabold text-[22px] tracking-[-0.03em]">
                  {year == null ? 'Study year not set' : `Year ${year}`}
                </h3>
                {semesterStart != null && (
                  <span className="font-mono text-[12px] text-ink2">
                    Sem {semesterStart}–{semesterStart + 1}
                  </span>
                )}
                <span className="text-[13px] text-ink2">{items.length} subjects</span>
              </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
              {items.map((course, index) => (
                <IndexCard key={course.id} course={course} index={start + index} animate={animate} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
