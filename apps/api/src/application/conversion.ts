import { BROKEN_SOURCE, type ConversionReport } from '@ss/contracts';
import type { CatalogueWriter } from '../domain/ports';

/**
 * Records a converter result. A file that can never convert (its R2 copy is a web page, empty,
 * or not what its name says) is kept off the site, so the rest of its course can still be
 * published; Admin → Files shows why, until a good copy is re-uploaded.
 */
export async function recordConversion(
  writer: Pick<CatalogueWriter, 'applyConversion' | 'setFileHidden'>,
  report: ConversionReport,
): Promise<void> {
  await writer.applyConversion(report);
  if (report.status === 'failed' && report.error?.startsWith(BROKEN_SOURCE)) {
    await writer.setFileHidden(report.fileId, true);
  }
}
