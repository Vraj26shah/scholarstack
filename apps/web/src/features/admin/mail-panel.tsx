import type { AnnouncementDto, FeatureDto, FeatureStatus } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { isDemo } from '../../lib/env';
import { Button } from '../../shared/ui/button';
import { ErrorState, Sheet, Skeleton } from '../../shared/ui/feedback';
import { ToolIcon } from '../tools/tool-icon';
import { AnnouncementRow } from './announcement-row';
import { Field, Note, Panel, StatusPill, U, input, plural } from './ui';

type Draft = Omit<
  AnnouncementDto,
  | 'status'
  | 'recipients'
  | 'sent'
  | 'waiting'
  | 'finishesOn'
  | 'error'
  | 'createdAt'
  | 'sentAt'
  | 'id'
  | 'course'
> & {
  id?: string;
  /** Only this course's students (null = everyone who opted in). */
  courseId: string | null;
};

const blank: Draft = {
  subject: '',
  heading: '',
  body: '',
  ctaLabel: '',
  ctaUrl: '',
  featureKey: null,
  courseId: null,
};

function FeatureRow({ f, onLaunched }: { f: FeatureDto; onLaunched: (a: AnnouncementDto) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: f.title, blurb: f.blurb, status: f.status });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-features'] });
    void qc.invalidateQueries({ queryKey: ['features'] });
  };
  const save = useMutation({ mutationFn: () => api.adminSaveFeature(f.key, form), onSuccess: refresh });
  const launch = useMutation({
    mutationFn: () => api.adminLaunchFeature(f.key),
    onSuccess: (a) => {
      refresh();
      void qc.invalidateQueries({ queryKey: ['admin-announcements'] });
      onLaunched(a);
    },
  });
  const dirty = form.title !== f.title || form.blurb !== f.blurb || form.status !== f.status;
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 grid grid-cols-[auto_1fr] gap-4">
      <span className="w-12 h-12 rounded-2xl bg-sunk text-ink2 inline-flex items-center justify-center">
        <ToolIcon toolKey={f.key} />
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1.2fr_2fr_auto] gap-3 items-end">
        <Field label="Name">
          <input
            className={input}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="One-line description" className="sm:col-span-2 md:col-span-1 md:order-none order-last">
          <input
            className={input}
            value={form.blurb}
            onChange={(e) => setForm({ ...form, blurb: e.target.value })}
          />
        </Field>
        <Field label="Status">
          <select
            className={input}
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as FeatureStatus })}
          >
            <option value="soon">Coming soon</option>
            <option value="live">Live</option>
            <option value="hidden">Hidden</option>
          </select>
        </Field>
        <div className="sm:col-span-2 md:col-span-3 grid grid-cols-[auto_1fr] items-center gap-2 sm:flex sm:flex-wrap">
          <span className="col-span-2 font-mono text-xs text-ink2 sm:col-span-1 sm:mr-auto">
            {f.path} · <StatusPill status={f.status} />
          </span>
          <Button variant="outline" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            Save
          </Button>
          {f.status !== 'live' && (
            <Button
              variant="buy"
              aria-label="Launch & draft the email"
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
            >
              <span className="sm:hidden">Launch + email</span>
              <span className="hidden sm:inline">Launch & draft the email</span>
            </Button>
          )}
        </div>
        {(save.isError || launch.isError) && (
          <p className="sm:col-span-2 md:col-span-3 m-0 text-sm text-blush-text">
            {friendly(save.error ?? launch.error)}
          </p>
        )}
      </div>
    </li>
  );
}

/** Adds a tool to the toolbox as "Coming soon". Its screen is built in code (see LAUNCH_GUIDE). */
function NewTool({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: '', title: '', blurb: '' });
  const key = form.key.trim().toLowerCase();
  const create = useMutation({
    mutationFn: () => api.adminCreateFeature({ ...form, key, status: 'soon' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-features'] });
      void qc.invalidateQueries({ queryKey: ['features'] });
      onDone();
    },
  });
  return (
    <form
      className="rounded-[18px] border border-dashed border-line bg-sunk p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[1fr_1.2fr_2fr] gap-3 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Key (its web address)">
        <input
          className={input}
          value={form.key}
          onChange={(e) => setForm({ ...form, key: e.target.value })}
          placeholder="attendance"
          required
        />
      </Field>
      <Field label="Name">
        <input
          className={input}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="Attendance tracker"
          required
        />
      </Field>
      <Field label="One-line description" className="sm:col-span-2 md:col-span-1">
        <input
          className={input}
          value={form.blurb}
          onChange={(e) => setForm({ ...form, blurb: e.target.value })}
          placeholder="See how many classes you can still miss."
        />
      </Field>
      <div className="sm:col-span-2 md:col-span-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink2 mr-auto">
          Shows on the home page as "Coming soon" at <span className="font-mono">/tools/{key || 'key'}</span>.
          Launch it once its screen is built.
        </span>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="brand"
          disabled={create.isPending || !key || form.title.trim().length < 2}
        >
          Add tool
        </Button>
      </div>
      {create.isError && (
        <p className="sm:col-span-2 md:col-span-3 m-0 text-sm text-blush-text">{friendly(create.error)}</p>
      )}
    </form>
  );
}

function Composer({
  initial,
  features,
  optedIn,
  onClose,
}: {
  initial: Draft;
  features: FeatureDto[];
  optedIn: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: api.adminCourses });
  const courseTitle = courses.data?.find((c) => c.id === d.courseId)?.title;
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin-announcements'] });
    void qc.invalidateQueries({ queryKey: ['admin-email'] });
    void qc.invalidateQueries({ queryKey: ['demo-outbox'] });
  };
  const save = useMutation({
    mutationFn: () => api.adminSaveAnnouncement(d),
    onSuccess: (a) => {
      setD((x) => ({ ...x, id: a.id }));
      refresh();
      return a;
    },
  });
  const ensureSaved = async () => (await save.mutateAsync()).id;
  const showPreview = useMutation({
    mutationFn: async () => (await api.adminPreviewAnnouncement(await ensureSaved())).html,
    onSuccess: setPreview,
  });
  const test = useMutation({
    mutationFn: async () => api.adminTestAnnouncement(await ensureSaved()),
    onSuccess: refresh,
  });
  const send = useMutation({
    mutationFn: async () => api.adminSendAnnouncement(await ensureSaved()),
    onSuccess: () => {
      refresh();
      setConfirm(false);
      onClose();
    },
  });
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const ok = d.subject.trim().length >= 3 && d.heading.trim().length >= 2 && d.body.trim().length >= 10;
  const err = save.error ?? showPreview.error ?? test.error ?? send.error;

  return (
    <div className="rounded-[22px] border-2 border-teal bg-surface p-5 flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Subject line" className="sm:col-span-2">
          <input className={input} value={d.subject} onChange={set('subject')} maxLength={120} />
        </Field>
        <Field label="Heading in the email" className="sm:col-span-2">
          <input className={input} value={d.heading} onChange={set('heading')} maxLength={120} />
        </Field>
        <Field label="Message (blank line = new paragraph, '- ' = bullet)" className="sm:col-span-2">
          <textarea
            className={`${input} h-40 py-2 leading-relaxed`}
            value={d.body}
            onChange={set('body')}
            maxLength={4000}
          />
        </Field>
        <Field label="Button text">
          <input
            className={input}
            value={d.ctaLabel}
            onChange={set('ctaLabel')}
            maxLength={40}
            placeholder="Open it"
          />
        </Field>
        <Field label="Button link (/path or https://…)">
          <input className={input} value={d.ctaUrl} onChange={set('ctaUrl')} placeholder="/tools/cgpa" />
        </Field>
        <Field label="Who gets it" className="sm:col-span-2">
          <select
            className={input}
            value={d.courseId ?? ''}
            onChange={(e) => setD({ ...d, courseId: e.target.value || null })}
          >
            <option value="">Everyone who opted in ({optedIn})</option>
            {(courses.data ?? [])
              .filter((c) => c.status === 'live')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  Students who have {c.title}
                </option>
              ))}
          </select>
        </Field>
        <Field label="About a tool (optional)">
          <select
            className={input}
            value={d.featureKey ?? ''}
            onChange={(e) => setD({ ...d, featureKey: e.target.value || null })}
          >
            <option value="">None</option>
            {features.map((f) => (
              <option key={f.key} value={f.key}>
                {f.title}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button variant="outline" onClick={() => save.mutate()} disabled={!ok || save.isPending}>
          Save draft
        </Button>
        <Button
          variant="outline"
          onClick={() => showPreview.mutate()}
          disabled={!ok || showPreview.isPending}
        >
          Preview
        </Button>
        <Button variant="outline" onClick={() => test.mutate()} disabled={!ok || test.isPending}>
          {test.isSuccess ? `Sent to ${test.data.to}` : 'Send me a test'}
        </Button>
        <Button variant="buy" className="ml-auto" onClick={() => setConfirm(true)} disabled={!ok}>
          {d.courseId
            ? `Send to ${courseTitle ?? 'the course'}'s students`
            : `Send to ${plural(optedIn, 'student')}`}
        </Button>
      </div>
      {err && <p className="m-0 text-sm text-blush-text">{friendly(err)}</p>}
      {preview && (
        <div className="rounded-2xl border border-line overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-sunk text-sm">
            <span>Preview, as a student sees it</span>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="border-0 bg-transparent text-teal-text cursor-pointer"
            >
              Hide
            </button>
          </div>
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview}
            className="w-full h-[560px] border-0 bg-white"
          />
        </div>
      )}
      <Sheet
        open={confirm}
        onOpenChange={setConfirm}
        title={d.courseId ? 'Send it to the course?' : 'Send it to everyone?'}
      >
        <p className="m-0 text-ink2">
          "{d.subject}" goes to{' '}
          {d.courseId
            ? `every student who has ${courseTitle ?? 'this course'}`
            : `${plural(optedIn, 'student')} who kept emails on`}
          . Each student gets it once; past the daily limit, the rest go out by themselves over the next days.
        </p>
        <Button variant="buy" size="lg" onClick={() => send.mutate()} disabled={send.isPending}>
          {send.isPending ? 'Sending…' : 'Yes, send now'}
        </Button>
        <Button variant="outline" onClick={() => setConfirm(false)}>
          Not yet
        </Button>
      </Sheet>
    </div>
  );
}

function DemoOutbox() {
  const q = useQuery({ queryKey: ['demo-outbox'], queryFn: api.demoOutbox, enabled: isDemo });
  if (!isDemo) return null;
  return (
    <details open className="rounded-[18px] border border-dashed border-line p-4">
      <summary className="cursor-pointer font-semibold">Demo outbox ({q.data?.length ?? 0} emails)</summary>
      <ul className="list-none m-0 mt-3 p-0 flex flex-col gap-1.5 font-mono text-xs">
        {q.data?.map((m, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: outbox rows have no id
          <li key={i}>
            → {m.to} · {m.subject}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function MailPanel() {
  const status = useQuery({ queryKey: ['admin-email'], queryFn: api.adminEmailStatus });
  const features = useQuery({ queryKey: ['admin-features'], queryFn: api.adminFeatures });
  const list = useQuery({
    queryKey: ['admin-announcements'],
    queryFn: api.adminAnnouncements,
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === 'sending') ? 15_000 : false),
  });
  const [composing, setComposing] = useState<Draft | null>(null);
  const [adding, setAdding] = useState(false);
  const s = status.data;

  return (
    <div className="flex flex-col gap-14">
      <Panel
        title="Emails to students"
        aside={
          !composing && (
            <Button variant="brand" onClick={() => setComposing(blank)}>
              Write an email
            </Button>
          )
        }
      >
        {s && (
          <Note>
            {s.provider === 'none' ? (
              <>
                Email is <U>not set up</U>: add BREVO_API_KEY to the Worker secrets.
              </>
            ) : (
              <>
                Goes to <U>{plural(s.optedIn, 'student')}</U> who opted in. Today <U>{s.leftToday} more</U>{' '}
                can go out ({s.usedToday} of {s.dailyLimit} used, {s.reserved} kept for receipts and replies)
                {s.plan.length > 0 && (
                  <>
                    ; then{' '}
                    {s.plan
                      .filter((p) => p.date !== new Date().toISOString().slice(0, 10))
                      .slice(0, 4)
                      .map(
                        (p) =>
                          `${new Date(`${p.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ${p.count}`,
                      )
                      .join(' · ')}
                  </>
                )}
                .
              </>
            )}
          </Note>
        )}
        {composing && features.data && (
          <Composer
            key={composing.id ?? 'new'}
            initial={composing}
            features={features.data}
            optedIn={s?.optedIn ?? 0}
            onClose={() => setComposing(null)}
          />
        )}
        {list.isError && <ErrorState title="Couldn't load emails." message={friendly(list.error)} />}
        <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
          {list.data?.map((a) => (
            <AnnouncementRow
              key={a.id}
              a={a}
              onOpen={() => setComposing({ ...a, courseId: a.course?.id ?? null })}
              onSend={() => api.adminSendAnnouncement(a.id).then(() => list.refetch())}
            />
          ))}
          {list.data?.length === 0 && <li className="text-ink2">Nothing sent yet.</li>}
        </ul>
        <DemoOutbox />
      </Panel>
      <Panel
        title="Tools on the home page"
        aside={
          !adding && (
            <Button variant="outline" onClick={() => setAdding(true)}>
              Add a tool
            </Button>
          )
        }
      >
        <Note>
          <U>Coming soon</U> shows a tool early; <U>Launch</U> makes it live and drafts the email to every
          student.
        </Note>
        {adding && <NewTool onDone={() => setAdding(false)} />}
        {features.isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
            {features.data?.map((f) => (
              <FeatureRow key={f.key} f={f} onLaunched={(a) => setComposing({ ...a, courseId: null })} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
