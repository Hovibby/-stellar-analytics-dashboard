import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ChartTooltip } from '../ChartTooltip';

describe('ChartTooltip', () => {
  it('renders header', () => {
    render(<ChartTooltip header="Test Header" rows={[]} />);
    expect(screen.getByText('Test Header')).toBeInTheDocument();
  });

  it('renders rows with label and value', () => {
    render(<ChartTooltip rows={[{ label: 'Volume', value: '1,000 XLM', color: '#10b981', dot: true }]} />);
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('1,000 XLM')).toBeInTheDocument();
  });

  it('renders multiple rows', () => {
    render(
      <ChartTooltip
        rows={[
          { label: 'Transactions', value: '500', dot: true },
          { label: 'Fee', value: '100 str', color: '#f59e0b', dot: true },
        ]}
      />
    );
    expect(screen.getByText('Transactions')).toBeInTheDocument();
    expect(screen.getByText('500')).toBeInTheDocument();
    expect(screen.getByText('Fee')).toBeInTheDocument();
    expect(screen.getByText('100 str')).toBeInTheDocument();
  });

  it('renders children', () => {
    render(
      <ChartTooltip rows={[]}>
        <div data-testid="child">Extra content</div>
      </ChartTooltip>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });
});
