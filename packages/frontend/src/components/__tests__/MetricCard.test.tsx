import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Activity } from 'lucide-react';
import { MetricCard } from '../MetricCard';

describe('MetricCard', () => {
  it('renders title and value', () => {
    render(<MetricCard title="Total Transactions" value={1234} icon={Activity} />);
    expect(screen.getByText('Total Transactions')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
  });

  it('formats currency values', () => {
    render(<MetricCard title="Volume" value={1234.5} icon={Activity} format="currency" />);
    expect(screen.getByText('1,234.50')).toBeInTheDocument();
  });

  it('formats percentage values', () => {
    render(<MetricCard title="Rate" value={42} icon={Activity} format="percentage" />);
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('shows changeLabel when provided', () => {
    render(<MetricCard title="Tx" value={100} icon={Activity} changeLabel="+5% vs yesterday" />);
    expect(screen.getByText('+5% vs yesterday')).toBeInTheDocument();
  });

  it('does not render change section when changeLabel is absent', () => {
    render(<MetricCard title="Tx" value={100} icon={Activity} />);
    expect(screen.queryByText(/trending/i)).not.toBeInTheDocument();
  });

  it('has accessible article label', () => {
    render(<MetricCard title="Ledgers" value={500} icon={Activity} />);
    expect(screen.getByRole('article', { name: /Ledgers: 500/i })).toBeInTheDocument();
  });

  it('accepts numeric string value', () => {
    render(<MetricCard title="Count" value="500" icon={Activity} />);
    expect(screen.getByText('500')).toBeInTheDocument();
  });
});
