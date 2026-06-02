import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Must be declared before component import so vitest hoists it
vi.mock('@apollo/client', () => ({
  useQuery: vi.fn(),
  gql: (s: TemplateStringsArray) => s,
}));

import { useQuery } from '@apollo/client';
import { TopAssets } from '../TopAssets';

const mockUseQuery = vi.mocked(useQuery);

describe('TopAssets', () => {
  it('shows loading skeleton', () => {
    mockUseQuery.mockReturnValue({ data: undefined, loading: true } as any);
    render(<TopAssets />);
    expect(screen.getByRole('status', { name: /loading market leaders/i })).toBeInTheDocument();
  });

  it('renders chart section with heading when data loaded', () => {
    mockUseQuery.mockReturnValue({
      loading: false,
      data: {
        assetMetrics: [
          { asset: { native: true, assetCode: null }, volume24h: '1000000' },
          { asset: { native: false, assetCode: 'USDC' }, volume24h: '500000' },
        ],
      },
    } as any);
    render(<TopAssets />);
    expect(screen.getByRole('heading', { name: /market leaders/i })).toBeInTheDocument();
  });

  it('renders empty chart when no data', () => {
    mockUseQuery.mockReturnValue({ loading: false, data: { assetMetrics: [] } } as any);
    render(<TopAssets />);
    expect(screen.getByRole('heading', { name: /market leaders/i })).toBeInTheDocument();
  });
});
