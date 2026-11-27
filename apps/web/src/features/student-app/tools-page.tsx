import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Page } from '../../shared/ui/chrome';
import { Skeleton } from '../../shared/ui/feedback';
import { ArrowRight, AskBubble, Upload } from '../../shared/ui/icons';
import { toolModule } from '../tools/registry';
import { AppHero, AppScreen, Row, RowGroup, SectionTitle, card } from './app-ui';

/** /app/tools: every student tool. */
export default function ToolsPage() {
  const me = useSession((s) => s.me);
  const q = useQuery({ queryKey: ['features'], queryFn: api.features, staleTime: 60_000 });
  const tools = (q.data ?? []).filter((f) => toolModule(f.key));
  return (
    <Page>
      <AppScreen>
        <AppHero
          eyebrow="Free for every student"
          title="Tools"
          sub="Your semester, sorted: grades, attendance, classes and food."
        />

        <section className="flex flex-col gap-3">
          <SectionTitle>Everyday</SectionTitle>
          {q.isLoading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[92px] rounded-[22px]" />
              ))}
            </div>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col gap-3">
              {tools.map((f) => {
                const Icon = toolModule(f.key)!.icon;
                const open = f.status === 'live' || !!me?.isAdmin;
                return (
                  <li key={f.key}>
                    <Link
                      to={`/tools/${f.key}`}
                      className={`${card} flex items-center gap-4 p-4 no-underline text-ink press`}
                    >
                      <span className="grid place-items-center size-14 flex-none rounded-[18px] bg-brand text-white">
                        <Icon size={24} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          <span className="text-[17px] font-bold leading-tight">{f.title}</span>
                          {!open && (
                            <span className="rounded-full bg-marigold-soft px-2 py-0.5 text-[10.5px] font-bold text-marigold-text">
                              Soon
                            </span>
                          )}
                        </span>
                        <span className="block text-[13.5px] leading-snug text-ink2 line-clamp-2 mt-0.5">
                          {f.blurb}
                        </span>
                      </span>
                      <ArrowRight size={18} className="flex-none text-ink2" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <RowGroup title="Give back">
          <Row
            to="/contribute"
            icon={<Upload size={21} />}
            title="Contribute your notes"
            hint="Earn when juniors buy them"
          />
          <Row
            to="/help"
            icon={<AskBubble size={21} />}
            title="Suggest a tool"
            hint="Tell us what would help"
          />
        </RowGroup>
      </AppScreen>
    </Page>
  );
}
