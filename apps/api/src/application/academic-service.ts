import type { AcademicDto, BranchSaveInput, MoveYearInput } from '@ss/contracts';
import type { AcademicRepository } from '../domain/ports';
import { fail } from './errors';

/**
 * Batch years and branches, edited from Admin instead of in the database. Moving a year's
 * courses is one step, so a new intake never means editing courses one by one.
 */
export class AcademicService {
  constructor(private readonly repo: AcademicRepository) {}

  async overview(): Promise<AcademicDto> {
    const [years, branches] = await Promise.all([this.repo.years(), this.repo.branches()]);
    return { years, branches };
  }

  async addYear(year: number) {
    await this.repo.saveYear(year, true);
    return this.overview();
  }

  async setYearVisible(year: number, visible: boolean) {
    if (!(await this.repo.years()).some((y) => y.year === year)) throw fail.notFound('That year');
    await this.repo.saveYear(year, visible);
    return this.overview();
  }

  async deleteYear(year: number) {
    const y = (await this.repo.years()).find((x) => x.year === year);
    if (!y) throw fail.notFound('That year');
    if (y.courses > 0)
      throw fail.badRequest(
        `${year} still has ${y.courses} courses. Move them to another year first, or hide the year.`,
      );
    await this.repo.deleteYear(year);
    return this.overview();
  }

  async saveBranch(input: BranchSaveInput) {
    const all = await this.repo.branches();
    const clash = all.find((b) => b.code === input.code && b.slug !== input.slug);
    if (clash) throw fail.badRequest(`The code ${input.code} is already used by ${clash.name}.`);
    await this.repo.saveBranch(input);
    return this.overview();
  }

  async moveYear(input: MoveYearInput) {
    if (input.fromYear === input.toYear) throw fail.badRequest('Pick two different years.');
    if (input.branchSlug && !(await this.repo.branches()).some((b) => b.slug === input.branchSlug))
      throw fail.notFound('That branch');
    const moved = await this.repo.moveCourses(input.fromYear, input.toYear, input.branchSlug ?? null);
    return { moved, ...(await this.overview()) };
  }
}
