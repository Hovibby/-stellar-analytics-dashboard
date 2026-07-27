import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ChartLegend } from '../ChartLegend';

describe('ChartLegend', () => {
  it('renders legend items with labels', () => {
    render(<ChartLegend items={[{ label: 'Successful', color: '#10b981' }, { label: 'Failed', color: '#ef4444' }]} />);
    expect(screen.getByText('Successful')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders nothing when items is empty', () => {
    const { container } = render(<ChartLegend items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('calls onClick when legend item is clicked', () => {
    const onClick = vi.fn();
    render(<ChartLegend items={[{ label: 'Test', color: '#000', onClick }]} />);
    fireEvent.click(screen.getByText('Test'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies dimmed opacity when active is false', () => {
    render(<ChartLegend items={[{ label: 'Dimmed', color: '#000', active: false }]} />);
    const btn = screen.getByText('Dimmed').closest('button');
    expect(btn).toHaveClass('opacity-40');
  });
});
