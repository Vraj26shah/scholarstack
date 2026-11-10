import { describe, expect, it } from 'vitest';
import { ConversionReport, SupportCreateBody, SupportReplyBody } from './schemas';

describe('ConversionReport', () => {
  const page = (pageNo: number) => ({
    pageNo,
    imageKey: `pages/file/${pageNo}.webp`,
    tileSeed: 'seed-value-1234',
  });

  it('accepts ready pages only when they are contiguous and have a preview', () => {
    expect(
      ConversionReport.safeParse({
        fileId: 'file',
        status: 'ready',
        pages: [page(1), page(2), page(3)],
        previewKey: 'pages/file/preview.webp',
      }).success,
    ).toBe(true);
  });

  it('rejects a ready report with a missing page', () => {
    expect(
      ConversionReport.safeParse({
        fileId: 'file',
        status: 'ready',
        pages: [page(1), page(3)],
        previewKey: 'pages/file/preview.webp',
      }).success,
    ).toBe(false);
  });

  it('rejects a ready report with pages out of order', () => {
    expect(
      ConversionReport.safeParse({
        fileId: 'file',
        status: 'ready',
        pages: [page(1), page(3), page(2)],
        previewKey: 'pages/file/preview.webp',
      }).success,
    ).toBe(false);
  });

  it('rejects a ready report with no pages or preview', () => {
    expect(ConversionReport.safeParse({ fileId: 'file', status: 'ready', pages: [] }).success).toBe(false);
  });

  it('accepts a failed conversion without publishing partial output', () => {
    expect(
      ConversionReport.safeParse({ fileId: 'file', status: 'failed', error: 'Invalid source', pages: [] })
        .success,
    ).toBe(true);
  });
});

describe('support message minimum lengths', () => {
  const query = {
    topic: 'other',
    subject: 'A clear topic',
    message: 'This is a detailed support request with enough context.',
  };

  it('requires a useful subject and initial query message', () => {
    expect(SupportCreateBody.safeParse(query).success).toBe(true);
    expect(SupportCreateBody.safeParse({ ...query, subject: 'Short' }).success).toBe(false);
    expect(SupportCreateBody.safeParse({ ...query, message: 'Too short to help.' }).success).toBe(false);
  });

  it('requires replies to contain at least 15 non-whitespace characters', () => {
    expect(SupportReplyBody.safeParse({ body: 'We have checked this for you.' }).success).toBe(true);
    expect(SupportReplyBody.safeParse({ body: '   Too short   ' }).success).toBe(false);
  });
});

describe('course blurbs', () => {
  it('every course on the Winter 2026-27 list has a short line', async () => {
    const { COURSE_BLURBS, courseBlurb } = await import('./course-blurbs');
    const { WINTER_2026_27_TITLES } = await import('./winter-2026-27-offerings');
    const missing = Object.keys(WINTER_2026_27_TITLES).filter((c) => !COURSE_BLURBS[c]);
    expect(missing).toEqual([]);
    for (const line of Object.values(COURSE_BLURBS)) expect(line.length).toBeLessThanOrEqual(100);
    expect(courseBlurb(null, 'Operating System')).toBe('');
    expect(courseBlurb(null, 'Operating Systems')).toContain('scheduling');
    expect(courseBlurb('cse3001')).toContain('SQL');
  });
});
