import { Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { BundlesPanel } from './bundles-panel';
import { CoursesPanel } from './courses-panel';
import { ImportPanel } from './import-panel';
import { MailPanel } from './mail-panel';
import { StorageAuditPanel } from './storage-audit-panel';

const TABS = [
  { key: 'import', label: 'Import' },
  { key: 'courses', label: 'Courses' },
  { key: 'storage', label: 'Storage audit' },
  { key: 'bundles', label: 'Bundles' },
  { key: 'tools', label: 'Tools & email' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export function AdminPage() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'import') as Tab;

  if (me && !me.isAdmin) return <Navigate to="/" replace />;

  return (
    <Page wide>
      <div className="pt-7 flex flex-col gap-6">
        <header className="flex flex-col gap-2 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.14em] text-ink2">Scholars Stack</p>
            <h1 className="m-0 mt-1 font-display text-[36px] font-extrabold leading-none tracking-[-0.045em]">
              Admin
            </h1>
          </div>
          <p className="m-0 max-w-[42ch] text-sm leading-relaxed text-ink2">
            Manage imports, course availability, and storage checks.
          </p>
        </header>
        <div
          role="tablist"
          aria-label="Admin sections"
          className="flex max-w-full gap-1 overflow-x-auto overflow-y-clip border-b border-line"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`admin-tab-${t.key}`}
              aria-controls="admin-panel"
              aria-selected={tab === t.key}
              onClick={() => setParams({ tab: t.key }, { replace: true })}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm transition-colors ${
                tab === t.key
                  ? 'border-teal-text font-semibold text-ink'
                  : 'border-transparent font-medium text-ink2 hover:border-line hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id="admin-panel" role="tabpanel" aria-labelledby={`admin-tab-${tab}`}>
          {tab === 'import' && <ImportPanel />}
          {tab === 'courses' && <CoursesPanel />}
          {tab === 'storage' && <StorageAuditPanel />}
          {tab === 'bundles' && <BundlesPanel />}
          {tab === 'tools' && <MailPanel />}
        </div>
      </div>
    </Page>
  );
}
