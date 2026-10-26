import type { ReactNode } from 'react';
import { AccessPanel } from './access-panel';
import { BundlesPanel } from './bundles-panel';
import { ContributionsPanel } from './contributions-panel';
import { ContributorsPanel } from './contributors-panel';
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
import { TodayPanel } from './today-panel';
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

/** Six places, each with a few views. Adding a screen means adding a view here, nothing else. */
export const GROUPS: Group[] = [
  {
    key: 'today',
    label: 'Today',
    views: [
      {
        key: 'today',
        label: 'Today',
        note: <>Only what needs you; everything else is in the tabs.</>,
        render: (go) => <TodayPanel go={go} />,
      },
    ],
  },
  {
    key: 'notes',
    label: 'Courses',
    views: [
      {
        key: 'courses',
        label: 'All courses',
        note: (
          <>
            Change prices and details, and <U>publish when ready</U>.
          </>
        ),
        render: () => <CoursesPanel />,
      },
      {
        key: 'import',
        label: 'Add courses',
        note: (
          <>
            Tick an uploaded folder to make it a course; <U>new courses start as drafts</U>.
          </>
        ),
        render: () => <ImportPanel />,
      },
      {
        key: 'sync',
        label: 'Make pages',
        note: (
          <>
            Turn uploaded files into <U>pages students can read</U>.
          </>
        ),
        render: (go) => <SyncFlow onGoImport={() => go('import')} />,
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
            Add a batch year or branch, or <U>move a whole year's courses at once</U>.
          </>
        ),
        render: () => <YearsBranchesPanel />,
      },
    ],
  },
  {
    key: 'students',
    label: 'Students',
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
        label: 'Earnings',
        note: (
          <>
            What each course earned, and <U>what you owe contributors</U>.
          </>
        ),
        render: () => <EarningsPanel />,
      },
      {
        key: 'contributors',
        label: 'Contributors',
        note: (
          <>
            Who shares notes, what's live and <U>what each of them is owed</U>.
          </>
        ),
        render: () => <ContributorsPanel />,
      },
    ],
  },
  {
    key: 'inbox',
    label: 'Inbox',
    views: [
      {
        key: 'queries',
        label: 'Questions',
        note: (
          <>
            Answer here and <U>the student gets an email</U>.
          </>
        ),
        render: () => <SupportPanel />,
      },
      {
        key: 'contributions',
        label: 'Uploads',
        note: (
          <>
            Each upload goes <U>check → decide → file → reward → pages → done</U>.
          </>
        ),
        render: () => <ContributionsPanel />,
      },
    ],
  },
  {
    key: 'email',
    label: 'Emails',
    views: [
      {
        key: 'features',
        label: 'Emails & tools',
        note: (
          <>
            To announce a tool, press <U>Launch</U> on it; for anything else, <U>Write an email</U>.
          </>
        ),
        render: () => <MailPanel />,
      },
    ],
  },
  {
    key: 'storage',
    label: 'Storage',
    views: [
      {
        key: 'files',
        label: 'Files',
        note: (
          <>
            Every uploaded file and its course. <U>Deleting is permanent</U>.
          </>
        ),
        render: () => <StorageTreePanel />,
      },
      {
        key: 'cleanup',
        label: 'Clean-up',
        note: (
          <>
            Find and remove <U>what nothing on the site uses</U>.
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
        label: 'Full check',
        note: (
          <>
            File-by-file check that <U>storage and the website agree</U>.
          </>
        ),
        render: () => <StorageAuditPanel />,
      },
    ],
  },
];

/** Links from before the regrouping (?section=, ?tab=, ?step=) still land in the right place. */
export const LEGACY: Record<string, string> = {
  today: 'today',
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
  contributors: 'contributors',
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
  const want = LEGACY[key ?? ''] ?? 'today';
  for (const g of GROUPS) for (const v of g.views) if (v.key === want) return { group: g, view: v };
  return { group: GROUPS[0]!, view: GROUPS[0]!.views[0]! };
}
