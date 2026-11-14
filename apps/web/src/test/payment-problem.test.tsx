import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentProblem } from '../features/checkout/payment-problem';
import type { BuyProblem } from '../features/checkout/use-buy';

afterEach(cleanup);

const mount = (problem: BuyProblem | null) =>
  render(
    <MemoryRouter>
      <PaymentProblem problem={problem} onRetry={() => {}} onClose={() => {}} />
    </MemoryRouter>,
  );

describe('PaymentProblem', () => {
  it.each(['declined', 'closed', 'blocked', 'unavailable', 'error'] as const)(
    'opens the result window for every failure kind (%s)',
    (kind) => {
      mount({ kind, message: 'the bank said no' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Try again')).toBeInTheDocument();
      expect(screen.getByText('Not now')).toBeInTheDocument();
    },
  );

  it('shows the bank’s reason on a decline', () => {
    mount({ kind: 'declined', message: 'Insufficient funds' });
    expect(screen.getByText('Insufficient funds')).toBeVisible();
    expect(screen.getByRole('img', { name: /NOT PAID/i })).toBeInTheDocument();
  });

  it('shows nothing while there is no problem', () => {
    mount(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retries and closes', async () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <PaymentProblem problem={{ kind: 'closed', message: '' }} onRetry={onRetry} onClose={onClose} />
      </MemoryRouter>,
    );
    await fireEvent.click(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
