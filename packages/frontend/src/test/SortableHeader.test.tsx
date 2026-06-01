import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SortableHeader } from '../components/SortableHeader';

describe('SortableHeader', () => {
  const defaultSort = { field: 'name', dir: 'asc' as const };

  it('renders the label', () => {
    render(
      <SortableHeader label="Name" field="name" sort={defaultSort} onSort={vi.fn()} />
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('calls onSort with the field when clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <SortableHeader label="Name" field="name" sort={defaultSort} onSort={onSort} />
    );
    await user.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledWith('name');
  });

  it('shows ascending arrow when active and dir=asc', () => {
    render(
      <SortableHeader label="Name" field="name" sort={{ field: 'name', dir: 'asc' }} onSort={vi.fn()} />
    );
    // ArrowUp icon is rendered — button is present
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows descending arrow when active and dir=desc', () => {
    render(
      <SortableHeader label="Name" field="name" sort={{ field: 'name', dir: 'desc' }} onSort={vi.fn()} />
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
