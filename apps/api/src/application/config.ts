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
  /** Feature emails per day, kept under the email provider's daily cap. */
  emailDailyLimit: number;
  /** Emails kept back each day for personal mail (receipts, answers, reminders). */
  emailReserve: number;
}
