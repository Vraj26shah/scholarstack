/** Plain settings the use cases need. Built once from env in the composition root. */
export interface AppConfig {
  allowedDomain: string;
  adminEmails: string[];
  currentIntakeYear: number;
  maxDevices: number;
  viewerTokenTtlSeconds: number;
  pagesPerDay: number;
  leaseSeconds: number;
  /** R2 folder the admin imports from, e.g. "drive-imports/". */
  importRoot: string;
  /** Public site URL, for links in emails. */
  appUrl: string;
  /** Sentry DSN for the monitoring tunnel ('' = accept any real Sentry ingest host). */
  sentryDsn: string;
  /** Feature emails per day, kept under the email provider's daily cap. */
  emailDailyLimit: number;
  /** Emails kept back each day for personal mail (receipts, answers, reminders). */
  emailReserve: number;
  /** Sign-in link emails the whole site may send in a day (see the sign-in guard). */
  signinEmailDailyLimit: number;
  /**
   * Whether sign-in links are budgeted per address, network and site. Always on for the real
   * site; off only for the demo server, which signs in instantly and sends no email (so the
   * end-to-end suite's many sign-ins from one machine aren't refused as a mail-draining attack).
   */
  signinLinkBudgets: boolean;
  /** Reminder notifications sent per five-minute run (each one is a Worker request). */
  pushPerRun: number;
  /**
   * Notifications per queued batch: each batch is a run of its own, with its own request budget.
   * Each one costs about 1 ms of encryption, and a free Worker run gets 10 ms of CPU: keep it small.
   */
  pushPerBatch: number;
}
