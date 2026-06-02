import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Activity } from 'lucide-react';
import { MetricCard } from '../components/MetricCard';

describe('MetricCard', () => {
  it('renders title and value', () => {
    render(<MetricCard title="Total Ledgers" value={12345} icon={Activity} />);
    expect(screen.getByText('Total Ledgers')).toBeInTheDocument();
    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('formats currency values', () => {
    render(<MetricCard title="Volume" value={1234.5} icon={Activity} format="currency" />);
    expect(screen.getByText('1,234.50')).toBeInTheDocument();
  });

  it('formats percentage values', () => {
    render(<MetricCard title="Success Rate" value={98} icon={Activity} format="percentage" />);
    expect(screen.getByText('98%')).toBeInTheDocument();
  });

  it('shows changeLabel when provided', () => {
    render(
      <MetricCard title="Txns" value={100} icon={Activity} change={5} changeLabel="+5% vs yesterday" />
    );
    expect(screen.getByText('+5% vs yesterday')).toBeInTheDocument();
  });

  it('does not render trend section when changeLabel is absent', () => {
    render(<MetricCard title="Txns" value={100} icon={Activity} />);
    expect(screen.queryByText(/trending/i)).not.toBeInTheDocument();
  });

  it('has accessible aria-label', () => {
    render(<MetricCard title="Total Ledgers" value={100} icon={Activity} />);
    const article = screen.getByRole('article');
    expect(article).toHaveAttribute('aria-label', expect.stringContaining('Total Ledgers'));
  });
});
