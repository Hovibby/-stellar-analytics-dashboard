import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@apollo/client', () => ({
  useQuery: vi.fn(),
  gql: (s: TemplateStringsArray) => s,
}));

import { useQuery } from '@apollo/client';
import { RecentTransactions } from '../RecentTransactions';

const mockUseQuery = vi.mocked(useQuery);

const mockTx = {
  hash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  successful: true,
  ledger: 12345,
  sourceAccount: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  createdAt: new Date().toISOString(),
};

describe('RecentTransactions', () => {
  it('shows loading skeleton', () => {
    mockUseQuery.mockReturnValue({ loading: true, data: undefined, error: undefined } as any);
    render(<MemoryRouter><RecentTransactions /></MemoryRouter>);
    expect(screen.getByRole('status', { name: /loading recent transactions/i })).toBeInTheDocument();
  });

  it('shows error message', () => {
    mockUseQuery.mockReturnValue({
      loading: false,
      data: undefined,
      error: { message: 'Network error' },
    } as any);
    render(<MemoryRouter><RecentTransactions /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });

  it('renders transactions table', () => {
    mockUseQuery.mockReturnValue({
      loading: false,
      error: undefined,
      data: { transactions: { edges: [{ node: mockTx }] } },
    } as any);
    render(<MemoryRouter><RecentTransactions /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: /recent transactions/i })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('renders view all link', () => {
    mockUseQuery.mockReturnValue({
      loading: false,
      error: undefined,
      data: { transactions: { edges: [] } },
    } as any);
    render(<MemoryRouter><RecentTransactions /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /view all transactions/i })).toBeInTheDocument();
  });
});
