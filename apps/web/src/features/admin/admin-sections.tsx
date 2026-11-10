import type { TodayKey } from '@ss/contracts';
import type { ReactNode } from 'react';
import { BundlesPanel } from './bundles-panel';
import { ContributionsPanel } from './contributions-panel';
import { ContributorsPanel } from './contributors-panel';
import { CourseListPanel } from './course-list-panel';
import { CoursesPanel } from './courses-panel';
import { EarningsPanel } from './earnings-panel';
import { FolderExplorer } from './folder-explorer';
import { MailPanel } from './mail-panel';
import { OffersPanel } from './offers-panel';
import { PageJobsPanel } from './page-jobs-panel';
import { ProblemsPanel } from './problems-panel';
import { StorageMapPanel } from './storage-map-panel';
import { StudentsPanel } from './students-panel';
import { SupportPanel } from './support-panel';
import { TodayPanel } from './today-panel';
import { U } from './ui';
import { YearsBranchesPanel } from './years-branches-panel';

export interface View {
  key: string;
  label: string;
  /** One line, the key words underlined. */
  note: ReactNode;
  render: (go: (view: string) => void) => ReactNode;
  /** The "needs you" items this view resolves; its badge is their total. */
  badge?: TodayKey[];
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
        note: <>See what needs attention.</>,
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
        badge: ['publish'],
        label: 'All courses',
        note: (
          <>
            Review and <U>publish courses</U>.
          </>
        ),
        render: () => <CoursesPanel />,
      },
      {
        key: 'folders',

        label: 'Folders',
        note: (
          <>
            Manage files and <U>create courses</U>.
          </>
        ),
        render: () => <FolderExplorer />,
      },
      {
        key: 'page-jobs',
        badge: ['files'],
        label: 'Page jobs',
        note: <>Track file conversion.</>,
        render: () => <PageJobsPanel />,
      },
      {
        key: 'bundles',
        label: 'Bundles',
        note: (
          <>
            Group courses and <U>set discounts</U>.
          </>
        ),
        render: () => <BundlesPanel />,
      },
      {
        key: 'offers',
        label: 'Offers',
        note: (
          <>
            Diwali and other sales: <U>a percentage off for a few days</U>, then prices go back.
          </>
        ),
        render: () => <OffersPanel />,
      },
      {
        key: 'course-list',
        label: 'Course list',
        note: (
          <>
            Which batch takes which course; <U>one course serves many batches</U>.
          </>
        ),
        render: () => <CourseListPanel />,
      },
      {
        key: 'years',
        label: 'Years & branches',
        note: <>Manage branches and move courses between years.</>,
        render: () => <YearsBranchesPanel />,
      },
    ],
  },
  {
    key: 'students',
    label: 'Students',
    views: [
      {
        key: 'students',
        label: 'Students',
        note: <>View accounts, courses, uploads and questions.</>,
        render: (go) => <StudentsPanel go={go} />,
      },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    views: [
      {
        key: 'earnings',
        badge: ['rewards'],
        label: 'Earnings',
        note: (
          <>
            Review sales and <U>payouts</U>.
          </>
        ),
        render: () => <EarningsPanel />,
      },
      {
        key: 'contributors',
        label: 'Contributors',
        note: (
          <>
            See who shared notes and <U>what they’ve earned</U>.
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
        badge: ['questions'],
        label: 'Questions',
        note: <>Reply to students by email.</>,
        render: () => <SupportPanel />,
      },
      {
        key: 'contributions',
        badge: ['uploads'],
        label: 'Uploads',
        note: <>Review and file uploads.</>,
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
        badge: ['emails'],
        label: 'Emails & tools',
        note: <>Manage tools and announcements.</>,
        render: () => <MailPanel />,
      },
    ],
  },
  {
    key: 'storage',
    label: 'Storage',
    views: [
      {
        key: 'cleanup',
        label: 'Clean-up',
        note: (
          <>
            Review <U>unused files</U>.
          </>
        ),
        render: () => <StorageMapPanel />,
      },
      {
        key: 'problems',
        badge: ['problems'],
        label: 'Problems',
        note: <>Review site errors and clear fixed issues.</>,
        render: () => <ProblemsPanel />,
      },
    ],
  },
];

/** Links from before the regrouping (?section=, ?tab=, ?step=) still land in the right place. */
export const LEGACY: Record<string, string> = {
  today: 'today',
  sync: 'folders',
  pages: 'folders',
  import: 'folders',
  folders: 'folders',
  courses: 'courses',
  publish: 'courses',
  bundles: 'bundles',
  sell: 'bundles',
  offers: 'offers',
  sale: 'offers',
  access: 'students',
  students: 'students',
  earnings: 'earnings',
  queries: 'queries',
  contributions: 'contributions',
  contributors: 'contributors',
  features: 'features',
  tools: 'features',
  storage: 'folders',
  audit: 'cleanup',
  problems: 'problems',
  years: 'years',
  files: 'folders',
  cleanup: 'cleanup',
  'page-jobs': 'page-jobs',
};

/**
 * Resolve a section key (from `?section=`) to a group + view pair.
 *
 * 1. Try a direct match on the current view keys first — this handles every active view,
 *    including any new ones added to GROUPS without needing a LEGACY entry.
 * 2. Fall back to the LEGACY map for old bookmarks / links that used previous names.
 * 3. Default to Today when neither matches.
 */
export function findView(key: string | null) {
  const raw = key ?? '';

  // Direct match against current view keys
  for (const g of GROUPS) for (const v of g.views) if (v.key === raw) return { group: g, view: v };

  // Legacy alias lookup
  const alias = LEGACY[raw];
  if (alias) {
    for (const g of GROUPS) for (const v of g.views) if (v.key === alias) return { group: g, view: v };
  }

  // Fallback to Today
  return { group: GROUPS[0]!, view: GROUPS[0]!.views[0]! };
}
