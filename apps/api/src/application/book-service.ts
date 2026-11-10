import type { AdminCourseBooksDto, CourseBookDto, CourseBookInput } from '@ss/contracts';
import type { CourseBook } from '../domain/entities';
import type { CatalogueReader, CourseBookRepository } from '../domain/ports';
import { readingBookCandidates } from './catalogue-service';
import { fail } from './errors';

const MAX_BOOKS = 20;
const dto = (b: CourseBook): CourseBookDto => ({ id: b.id, title: b.title, author: b.author, url: b.url });
const keyOf = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Recommended books, kept as a name and a link per course. Nothing is stored in the notes
 * bucket for them. Until a course has its own list, students see the textbook titles found
 * in its folder; once the admin adds one book, the list is entirely the admin's.
 */
export class BookService {
  constructor(
    private readonly catalogue: CatalogueReader,
    private readonly books: CourseBookRepository,
  ) {}

  private async course(courseId: string) {
    const course = await this.catalogue.findCourse(courseId);
    if (!course) throw fail.notFound('That course');
    return course;
  }

  async list(courseId: string): Promise<AdminCourseBooksDto> {
    await this.course(courseId);
    const [books, hidden] = await Promise.all([
      this.books.list(courseId),
      this.catalogue.listHiddenFiles([courseId]),
    ]);
    const have = new Set(books.map((b) => keyOf(b.title)));
    return {
      books: books.map(dto),
      found: readingBookCandidates(hidden)
        .filter((r) => !have.has(keyOf(r.title)))
        .map((r) => ({ title: r.title, unit: r.unit, sourceKeys: r.sourceKeys })),
    };
  }

  async add(courseId: string, input: CourseBookInput) {
    await this.course(courseId);
    const books = await this.books.list(courseId);
    if (books.length >= MAX_BOOKS) throw fail.badRequest(`A course can list up to ${MAX_BOOKS} books.`);
    if (books.some((b) => keyOf(b.title) === keyOf(input.title)))
      throw fail.badRequest('That book is already on this course.');
    await this.books.add({
      courseId,
      title: input.title,
      author: input.author,
      url: input.url,
      sort: books.length ? Math.max(...books.map((b) => b.sort)) + 1 : 0,
    });
    return this.list(courseId);
  }

  async update(bookId: string, input: CourseBookInput) {
    const book = await this.books.find(bookId);
    if (!book) throw fail.notFound('That book');
    await this.books.update(bookId, { title: input.title, author: input.author, url: input.url });
    return this.list(book.courseId);
  }

  async remove(bookId: string) {
    const book = await this.books.find(bookId);
    if (!book) throw fail.notFound('That book');
    await this.books.remove(bookId);
    return this.list(book.courseId);
  }

  async reorder(courseId: string, ids: string[]) {
    const books = await this.books.list(courseId);
    const mine = new Set(books.map((b) => b.id));
    if (ids.length !== books.length || ids.some((id) => !mine.has(id)))
      throw fail.badRequest('The list changed. Reload and try again.');
    await this.books.reorder(courseId, ids);
    return this.list(courseId);
  }
}
