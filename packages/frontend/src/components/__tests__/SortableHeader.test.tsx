import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { SortableHeader } from '../SortableHeader';
import type { SortState } from '@/hooks/useFilterSort';

const inactive: SortState = { field: 'other', dir: 'asc' };
const activeAsc: SortState = { field: 'amount', dir: 'asc' };
const activeDesc: SortState = { field: 'amount', dir: 'desc' };

describe('SortableHeader', () => {
  it('renders label', () => {
    render(<SortableHeader label="Amount" field="amount" sort={inactive} onSort={vi.fn()} />);
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('calls onSort with field on click', async () => {
    const onSort = vi.fn();
    render(<SortableHeader label="Amount" field="amount" sort={inactive} onSort={onSort} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('amount');
  });

  it('renders button when active asc', () => {
    render(<SortableHeader label="Amount" field="amount" sort={activeAsc} onSort={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders button when active desc', () => {
    render(<SortableHeader label="Amount" field="amount" sort={activeDesc} onSort={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(
      <SortableHeader label="Amount" field="amount" sort={inactive} onSort={vi.fn()} className="custom" />
    );
    expect(screen.getByRole('button')).toHaveClass('custom');
  });
});
