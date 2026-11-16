import type { PackRunDto } from '@ss/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PacksCard } from '../features/admin/packs-card';
import { api } from '../lib/api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const run = (titlePrefix: string): PackRunDto => ({
  settings: { status: 'live', titlePrefix, keepInSync: true },
  plans: [],
  totals: { create: 0, update: 0, same: 49, retire: 0, skip: 0 },
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

describe('PacksCard', () => {
  it('warns when packs carry a festival name with no offer running, and renames them in one click', async () => {
    vi.spyOn(api, 'adminPacks').mockResolvedValue(run('Diwali pack'));
    vi.spyOn(api, 'adminOffers').mockResolvedValue([]);
    const build = vi
      .spyOn(api, 'adminRunPacks')
      .mockResolvedValue({ ...run('Semester pack'), applied: true });
    renderCard();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Your packs are called "Diwali pack"');
    expect(alert.textContent).toContain('no offer is running');
    await act(async () =>
      screen.getByRole('button', { name: 'Rename every pack to "Semester pack"' }).click(),
    );
    expect(build).toHaveBeenCalledWith({
      dryRun: false,
      status: 'live',
      titlePrefix: 'Semester pack',
      keepInSync: true,
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says nothing when packs already have an all-year name', async () => {
    vi.spyOn(api, 'adminPacks').mockResolvedValue(run('Semester pack'));
    vi.spyOn(api, 'adminOffers').mockResolvedValue([]);
    renderCard();
    await screen.findByText(/Titles read "Semester pack · 2025 BCE"/);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
