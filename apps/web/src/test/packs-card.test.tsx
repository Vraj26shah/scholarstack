import { PACK_LADDER_RUPEES, PACK_SIZES, type PackRunDto, ladderProblems } from '@ss/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PacksCard, ladderFromRule } from '../features/admin/packs-card';
import { api } from '../lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const run = (titlePrefix: string, ladder = PACK_LADDER_RUPEES): PackRunDto => ({
  settings: { status: 'live', titlePrefix, keepInSync: true, ladder },
  plans: [],
  totals: { create: 0, update: 0, same: 49, retire: 0, skip: 0 },
  coursePrices: { minPaise: 7900, maxPaise: 9900, averagePaise: 9300 },
  applied: false,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PacksCard />
    </QueryClientProvider>,
  );
}

describe('suggested pack prices', () => {
  it('cost more in total and less per course at every size', () => {
    expect(ladderProblems(PACK_LADDER_RUPEES)).toEqual([]);
    const per = PACK_SIZES.map((n) => PACK_LADDER_RUPEES[String(n)]! / n);
    for (let i = 1; i < per.length; i++) expect(per[i]).toBeLessThan(per[i - 1]!);
  });

  it('a rule fills every size with a sound price list', () => {
    for (const [first, drop] of [
      [75, 2.5],
      [90, 0],
      [60, 5],
      [99, 10],
    ] as const) {
      expect(ladderProblems(ladderFromRule(first, drop))).toEqual([]);
    }
  });
});

describe('PacksCard', () => {
  it('warns when packs carry a festival name, starts the box on an all-year name, renames in one click', async () => {
    let stored = run('Diwali pack');
    vi.spyOn(api, 'adminPacks').mockImplementation(async () => stored);
    vi.spyOn(api, 'adminOffers').mockResolvedValue([]);
    const build = vi.spyOn(api, 'adminRunPacks').mockImplementation(async (b) => {
      stored = run(b.titlePrefix, b.ladder);
      return { ...stored, applied: true };
    });
    renderCard();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your packs are called "Diwali pack"');
    expect(alert.textContent).toContain('no offer is running');
    // No second, red warning: the name box already holds an all-year name.
    expect((screen.getByLabelText('Pack name') as HTMLInputElement).value).toBe('Semester pack');
    expect(screen.queryByText(/Leave festival names out/)).toBeNull();
    await act(async () =>
      screen.getByRole('button', { name: 'Rename every pack to "Semester pack"' }).click(),
    );
    expect(build).toHaveBeenCalledWith({
      dryRun: false,
      status: 'live',
      titlePrefix: 'Semester pack',
      keepInSync: true,
      ladder: PACK_LADDER_RUPEES,
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('still works when an older server sends no price list', async () => {
    const { ladder: _ladder, ...old } = run('Semester pack').settings;
    vi.spyOn(api, 'adminPacks').mockResolvedValue({
      ...run('Semester pack'),
      settings: old as PackRunDto['settings'],
    });
    vi.spyOn(api, 'adminOffers').mockResolvedValue([]);
    renderCard();
    const box = await screen.findByLabelText('Price for 5 courses, rupees');
    expect((box as HTMLInputElement).value).toBe(String(PACK_LADDER_RUPEES['5']));
  });

  it('edits prices, refuses a list where a bigger pack costs more per course, previews and applies', async () => {
    // A small fake server: previews report 49 changes; a build is remembered and read back.
    let stored = run('Semester pack');
    vi.spyOn(api, 'adminPacks').mockImplementation(async () => stored);
    vi.spyOn(api, 'adminOffers').mockResolvedValue([]);
    const calls = vi.spyOn(api, 'adminRunPacks').mockImplementation(async (b) => {
      const out = {
        ...run(b.titlePrefix, b.ladder),
        totals: { create: 0, update: 49, same: 0, retire: 0, skip: 0 },
        applied: !b.dryRun,
      };
      if (!b.dryRun) stored = run(b.titlePrefix, b.ladder);
      return out;
    });
    renderCard();
    await screen.findByLabelText('Price for 4 courses, rupees');
    // The savings line comes from the real course prices, not fixed text.
    const line = screen.getByText(
      (_, el) => el?.tagName === 'P' && /^Your live courses are/.test(el.textContent ?? ''),
    );
    // ₹79 to ₹99, ₹93 on average: 5 × ₹93 − ₹389 = ₹76 saved.
    expect(line.textContent).toContain('₹79 to ₹99 one by one (₹93 on average)');
    expect(line.textContent).toContain('a 5-course pack at ₹389 saves about ₹76');

    const four = screen.getByLabelText('Price for 4 courses, rupees');
    fireEvent.change(four, { target: { value: '349' } }); // ₹87.25 a course: dearer than 3 for ₹249
    expect(screen.getByRole('list', { name: 'Price problems' }).textContent).toContain(
      '4 courses: Must be cheaper per course than the 3-course pack: ₹331 or less.',
    );
    expect(screen.getByText('Fix the highlighted prices or name to see what would change.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply changes' }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(four, { target: { value: '329' } }); // ₹82.25 a course: between 3 and 5
    expect(screen.queryByRole('list', { name: 'Price problems' })).toBeNull();
    const apply = await screen.findByRole('button', { name: 'Apply to 49 packs' }, { timeout: 3000 });
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, ladder: { ...PACK_LADDER_RUPEES, 4: 329 } }),
    );
    const before = calls.mock.calls.length;
    await act(async () => apply.click());
    // One request: the build itself, and no extra preview after it.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Apply to/ })).toBeNull());
    expect(calls.mock.calls.length).toBe(before + 1);
    expect(calls).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: false, ladder: { ...PACK_LADDER_RUPEES, 4: 329 } }),
    );
  });
});
