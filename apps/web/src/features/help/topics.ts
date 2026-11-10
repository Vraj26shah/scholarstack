import type { SupportStatus, SupportTopic } from '@ss/contracts';

/** How each topic reads to students; one place for both the Help page and Admin. */
export const TOPICS: Record<SupportTopic, { label: string; hint: string }> = {
  feature: { label: 'Something broke', hint: 'A screenshot helps us fix it fast.' },
  suggestion: { label: 'A suggestion', hint: 'An idea for a tool, a course or the site.' },
  notes: { label: 'Notes', hint: 'Missing pages, a wrong unit, a blurry scan.' },
  payment: { label: 'Payment', hint: 'Paid but no course? Tell us the time you paid.' },
  contribute: { label: 'Uploads & earnings', hint: 'Your uploaded notes, royalty or reward.' },
  account: { label: 'Account', hint: 'Sign-in, devices or emails.' },
  other: { label: 'Other', hint: 'Anything else.' },
};

export const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Waiting for us',
  answered: 'Answered',
  closed: 'Closed',
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
