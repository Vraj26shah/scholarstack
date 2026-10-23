/**
 * Runs the page converter in this process for local conversion: downloads each file from
 * R2, renders scrambled pages + a page-one preview back into R2, and records the result in
 * Supabase directly. Same pipeline as the Actions job (converter/src/pipeline.ts).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConversionReport } from '@ss/contracts';
import { CliRasterizer, ConvertPages } from '@ss/converter/pipeline';
import { recordConversion } from '../application/conversion';
import type { CatalogueWriter, ConversionJob, ConversionQueue } from '../domain/ports';
import type { S3ObjectStore } from '../infrastructure/s3';

export class LocalConverter {
  private readonly pipeline: ConvertPages;
  constructor(
    store: S3ObjectStore,
    catalogue: Pick<CatalogueWriter, 'applyConversion' | 'setFileHidden'>,
    seedSecret: string,
  ) {
    this.pipeline = new ConvertPages(
      store,
      new CliRasterizer(150),
      { report: (r: ConversionReport) => recordConversion(catalogue, r) },
      seedSecret,
      join(tmpdir(), 'ss-convert'),
    );
  }

  /** Converts jobs with a small worker pool (each file is CPU- and memory-heavy). */
  async run(
    jobs: ConversionJob[],
    onDone?: (job: ConversionJob, report: ConversionReport, index: number) => void,
    concurrency = 1,
  ): Promise<{ ready: number; failed: number }> {
    let ready = 0;
    let failed = 0;
    let next = 0;
    let finished = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        const report = await this.pipeline.run(job);
        if (report.status === 'ready') ready++;
        else failed++;
        onDone?.(job, report, finished++);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
    return { ready, failed };
  }
}

/** ConversionQueue for the local live server: converts in the background, one file at a time. */
export class LocalConversionQueue implements ConversionQueue {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private readonly converter: LocalConverter) {}
  async enqueue(jobs: ConversionJob[]): Promise<void> {
    this.chain = this.chain
      .then(() =>
        this.converter.run(jobs, (job, r) =>
          console.log(`${r.status === 'ready' ? '✓' : '✗'} ${job.sourceKey} → ${r.pages.length} pages`),
        ),
      )
      .catch((e) => console.error('conversion error', e));
  }
}
