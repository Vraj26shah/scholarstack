import type { ReactNode } from 'react';
import { AccessPanel } from './access-panel';
import { BundlesPanel } from './bundles-panel';
import { ContributionsPanel } from './contributions-panel';
import { CoursesPanel } from './courses-panel';
import { EarningsPanel } from './earnings-panel';
import { ImportPanel } from './import-panel';
import { MailPanel } from './mail-panel';
import { ProblemsPanel } from './problems-panel';
import { StorageAuditPanel } from './storage-audit-panel';
import { StorageMapPanel } from './storage-map-panel';
import { StorageTreePanel } from './storage-tree-panel';
import { SupportPanel } from './support-panel';
import { SyncFlow } from './sync-flow';
import { U } from './ui';
import { YearsBranchesPanel } from './years-branches-panel';

export interface View {
  key: string;
  label: string;
  /** One line, the key words underlined. */
  note: ReactNode;
  render: (go: (view: string) => void) => ReactNode;
}

export interface Group {
  key: string;
  label: string;
  views: View[];
}

/** Five places, each with a few views. Adding a screen means adding a view here, nothing else. */
export const GROUPS: Group[] = [
  {
    key: 'notes',
    label: 'Notes & courses',
    views: [
      {
        key: 'sync',
        label: 'R2 → Website',
        note: (
          <>
            Pick files in R2 and <U>make their pages</U> so students can read them.
          </>
        ),
        render: (go) => <SyncFlow onGoImport={() => go('import')} />,
      },
      {
        key: 'import',
        label: 'Import',
        note: (
          <>
            Turn R2 folders into courses; <U>new courses start as drafts</U>.
          </>
        ),
        render: () => <ImportPanel />,
      },
      {
        key: 'courses',
        label: 'Courses',
        note: (
          <>
            Edit, hide units and <U>publish when ready</U>.
          </>
        ),
        render: () => <CoursesPanel />,
      },
      {
        key: 'bundles',
        label: 'Bundles',
        note: (
          <>
            Sell several courses <U>together at a discount</U>.
          </>
        ),
        render: () => <BundlesPanel />,
      },
      {
        key: 'years',
        label: 'Years & branches',
        note: (
          <>
            Add a new batch year or branch, and <U>move a whole year's courses in one step</U>.
          </>
        ),
        render: () => <YearsBranchesPanel />,
      },
    ],
  },
  {
    key: 'students',
    label: 'Students & money',
    views: [
      {
        key: 'access',
        label: 'Access',
        note: (
          <>
            Who has each course; <U>give a course by email</U>, block or extend.
          </>
        ),
        render: () => <AccessPanel />,
      },
      {
        key: 'earnings',
        label: 'Earnings & royalties',
        note: (
          <>
            What each course earned, and <U>what you owe contributors</U>.
          </>
        ),
        render: () => <EarningsPanel />,
      },
    ],
  },
  {
    key: 'inbox',
    label: 'Inbox',
    views: [
      {
        key: 'queries',
        label: 'Questions & suggestions',
        note: (
          <>
            Answer here and <U>the student gets an email</U>.
          </>
        ),
        render: () => <SupportPanel />,
      },
      {
        key: 'contributions',
        label: 'Uploaded notes',
        note: (
          <>
            Download, decide and <U>reward the good ones</U>.
          </>
        ),
        render: () => <ContributionsPanel />,
      },
    ],
  },
  {
    key: 'email',
    label: 'Email & tools',
    views: [
      {
        key: 'features',
        label: 'Email & tools',
        note: (
          <>
            To announce a tool, press <U>Launch</U> on it (the email is written for you); for anything else,
            press <U>Write an email</U>.
          </>
        ),
        render: () => <MailPanel />,
      },
    ],
  },
  {
    key: 'storage',
    label: 'Storage & health',
    views: [
      {
        key: 'files',
        label: 'Files & folders',
        note: (
          <>
            Every file in R2 and its course; <U>deleting removes it from R2 and Supabase</U>.
          </>
        ),
        render: () => <StorageTreePanel />,
      },
      {
        key: 'cleanup',
        label: 'Clean-up',
        note: (
          <>
            Remove <U>leftover pages and unpaid checkouts</U>, and see database sizes.
          </>
        ),
        render: () => <StorageMapPanel />,
      },
      {
        key: 'problems',
        label: 'Problems',
        note: (
          <>
            What went wrong for students and on the server; <U>students never see this</U>.
          </>
        ),
        render: () => <ProblemsPanel />,
      },
      {
        key: 'audit',
        label: 'Full audit',
        note: (
          <>
            Object-by-object check of <U>R2 against Supabase</U>.
          </>
        ),
        render: () => <StorageAuditPanel />,
      },
    ],
  },
];

/** Links from before the regrouping (?section=, ?tab=, ?step=) still land in the right place. */
export const LEGACY: Record<string, string> = {
  sync: 'sync',
  pages: 'sync',
  import: 'import',
  courses: 'courses',
  publish: 'courses',
  bundles: 'bundles',
  sell: 'bundles',
  access: 'access',
  earnings: 'earnings',
  queries: 'queries',
  contributions: 'contributions',
  features: 'features',
  tools: 'features',
  storage: 'files',
  audit: 'audit',
  problems: 'problems',
  years: 'years',
  files: 'files',
  cleanup: 'cleanup',
};

export function findView(key: string | null) {
  const want = LEGACY[key ?? ''] ?? 'sync';
  for (const g of GROUPS) for (const v of g.views) if (v.key === want) return { group: g, view: v };
  return { group: GROUPS[0]!, view: GROUPS[0]!.views[0]! };
}
