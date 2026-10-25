import type { ProblemDto } from '@ss/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, friendly } from '../../lib/api';
import { Button } from '../../shared/ui/button';
import { Panel, plural } from './ui';

const KIND: Record<string, { label: string; tone: string; help: string }> = {
  server: {
    label: 'Server error',
    tone: 'bg-blush text-blush-text',
    help: 'The API failed. Check the Worker logs around this time.',
  },
  crash: {
    label: 'Page crashed',
    tone: 'bg-blush text-blush-text',
    help: 'A script error on this page in the student’s browser.',
  },
  unhandled: {
    label: 'Script error',
    tone: 'bg-blush text-blush-text',
    help: 'Something in the page failed without being handled.',
  },
  api: {
    label: 'Reader problem',
    tone: 'bg-marigold/25 text-ink',
    help: 'The reader could not open or load a page.',
  },
  image: {
    label: 'Preview missing',
    tone: 'bg-marigold/25 text-ink',
    help: 'A page-one preview would not load. Re-make that file’s pages in R2 → Website.',
  },
  blocked: {
    label: 'Blocked by browser',
    tone: 'bg-sunk text-ink',
    help: 'An ad blocker or strict browser stopped the payment window or the sign-in check. The student was shown how to fix it.',
  },
  payment: {
    label: 'Payments',
    tone: 'bg-blush text-blush-text',
    help: 'Razorpay refused to start a payment. Check the Razorpay card in Overview.',
  },
  chunk: {
    label: 'Old version',
    tone: 'bg-sunk text-ink',
    help: 'A tab from before a deploy; it reloaded itself. Nothing to do.',
  },
};

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

function Row({ p, selected, onToggle }: { p: ProblemDto; selected: boolean; onToggle: () => void }) {
  const [open, setOpen] = useState(false);
  const k = KIND[p.kind] ?? { label: p.kind, tone: 'bg-sunk text-ink', help: '' };
  return (
    <li className="rounded-2xl bg-card shadow-[0_0_0_1px_var(--line)] p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start gap-3 min-w-0">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select: ${p.message}`}
          className="mt-1 size-4 flex-none accent-teal"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-[12px] font-semibold ${k.tone}`}>{k.label}</span>
            <span className="text-[12px] text-ink2">
              {plural(p.count, 'time')} · last {ago(p.lastAt)}
              {p.device ? ` · ${p.device}` : ''}
            </span>
          </div>
          <p className="m-0 font-semibold text-[15px] [overflow-wrap:anywhere]">{p.message}</p>
          {p.path && <p className="m-0 font-mono text-[12px] text-ink2 break-all">{p.path}</p>}
          {k.help && <p className="m-0 text-[13px] text-ink2">{k.help}</p>}
          {p.detail && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="self-start text-[13px] font-semibold text-teal-text"
            >
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
          {open && (
            <pre className="m-0 max-h-60 overflow-auto rounded-xl bg-sunk p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
              {p.detail}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}

/** What went wrong for students and on the server, grouped, newest first. */
export function ProblemsPanel() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'problems'],
    queryFn: api.adminProblems,
    refetchInterval: 60_000,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'server' | 'browser'>('all');
  const clear = useMutation({
    mutationFn: (fps?: string[]) => api.adminClearProblems(fps),
    onSuccess: () => {
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['admin', 'problems'] });
    },
  });
  const all = q.data ?? [];
  const rows = all.filter((p) => filter === 'all' || p.source === filter);
  const toggle = (fp: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(fp)) n.delete(fp);
      else n.add(fp);
      return n;
    });
  return (
    <Panel
      title="Problems"
      aside={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? 'Checking…' : 'Refresh'}
          </Button>
          {picked.size > 0 && (
            <Button variant="outline" onClick={() => clear.mutate([...picked])} disabled={clear.isPending}>
              Mark {picked.size} as fixed
            </Button>
          )}
          {all.length > 0 && picked.size === 0 && (
            <Button variant="outline" onClick={() => clear.mutate(undefined)} disabled={clear.isPending}>
              Clear all
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {(['all', 'browser', 'server'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`h-9 rounded-full px-3.5 text-sm font-semibold border ${filter === f ? 'bg-brand text-white border-brand' : 'border-line text-ink2'}`}
          >
            {f === 'all' ? `All (${all.length})` : f === 'browser' ? 'Students’ browsers' : 'Server'}
          </button>
        ))}
      </div>
      {q.isError && <p className="m-0 text-sm text-blush-text">{friendly(q.error)}</p>}
      {clear.isError && <p className="m-0 text-sm text-blush-text">{friendly(clear.error)}</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="m-0 rounded-2xl bg-card p-5 text-ink2 shadow-[0_0_0_1px_var(--line)]">
          Nothing has gone wrong{filter === 'all' ? '' : ' here'}. New problems appear within a minute.
        </p>
      )}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {rows.map((p) => (
          <Row
            key={p.fingerprint}
            p={p}
            selected={picked.has(p.fingerprint)}
            onToggle={() => toggle(p.fingerprint)}
          />
        ))}
      </ul>
    </Panel>
  );
}
