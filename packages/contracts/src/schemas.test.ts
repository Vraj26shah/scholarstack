import { describe, expect, it } from 'vitest';
import { ConversionReport } from './schemas';

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
