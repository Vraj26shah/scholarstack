/**
 * Where unexpected server errors are reported, besides the logs and the admin's Problems log.
 * The Worker plugs Sentry in here (worker.ts); tests, demo mode and the Node server leave it as a
 * no-op, so the HTTP app itself never depends on Sentry.
 */
export interface ErrorContext {
  /** Where it happened: "GET /api/orders", or "cron drawer-packs". */
  where: string;
  requestId?: string;
}

type Reporter = (error: unknown, context: ErrorContext) => void;

let reporter: Reporter = () => {};

export function setErrorReporter(next: Reporter): void {
  reporter = next;
}

/** Never throws: reporting must not turn one error into two. */
export function reportServerError(error: unknown, context: ErrorContext): void {
  try {
    reporter(error, context);
  } catch {
    // ignore
  }
}
