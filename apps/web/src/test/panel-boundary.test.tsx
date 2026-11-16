import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PanelBoundary } from '../features/admin/panel-boundary';

vi.mock('../lib/problems', () => ({ reportProblem: vi.fn() }));
vi.mock('../lib/analytics', () => ({ captureException: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let broken = true;
function Section() {
  if (broken) throw new Error('bad data');
  return <p>Promo codes list</p>;
}

describe('PanelBoundary', () => {
  it('keeps a crashing admin section inside its own box, reports it, and lets the admin try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { reportProblem } = await import('../lib/problems');
    broken = true;
    const { rerender } = render(
      <div>
        <nav>Admin tabs</nav>
        <PanelBoundary resetKey="promo-codes" label="Promo codes">
          <Section />
        </PanelBoundary>
      </div>,
    );
    // The tabs are still there; only the section shows the problem.
    expect(screen.getByText('Admin tabs')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain("Promo codes couldn't be shown just now.");
    expect(reportProblem).toHaveBeenCalledWith('crash', 'Admin › Promo codes: bad data', expect.any(String));

    broken = false;
    await act(async () => screen.getByRole('button', { name: 'Try again' }).click());
    expect(screen.getByText('Promo codes list')).toBeTruthy();

    // Opening another section clears a problem too.
    broken = true;
    rerender(
      <PanelBoundary resetKey="promo-codes" label="Promo codes">
        <Section />
      </PanelBoundary>,
    );
    broken = false;
    rerender(
      <PanelBoundary resetKey="offers" label="Offers">
        <Section />
      </PanelBoundary>,
    );
    expect(screen.getByText('Promo codes list')).toBeTruthy();
  });
});
