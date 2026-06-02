import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DataTable } from '../DataTable';
import type { SortState } from '@/hooks/useFilterSort';

vi.mock('framer-motion', () => ({
  motion: {
    tr: ({ children, ...props }: any) => <tr {...props}>{children}</tr>,
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

interface Row { id: number; name: string; value: number }

const columns = [
  { header: 'Name', accessor: 'name' as keyof Row },
  { header: 'Value', accessor: 'value' as keyof Row, sortField: 'value' },
];

const data: Row[] = [
  { id: 1, name: 'Alice', value: 100 },
  { id: 2, name: 'Bob', value: 200 },
];

const sort: SortState = { field: 'value', dir: 'asc' };

describe('DataTable', () => {
  it('renders column headers', () => {
    render(<DataTable columns={columns} data={data} sort={sort} />);
    expect(screen.getAllByText('Name').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
  });

  it('renders row data', () => {
    render(<DataTable columns={columns} data={data} sort={sort} />);
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
  });

  it('calls onSort when sortable header clicked', async () => {
    const onSort = vi.fn();
    render(<DataTable columns={columns} data={data} sort={sort} onSort={onSort} />);
    const sortButtons = screen.getAllByRole('button');
    await userEvent.click(sortButtons[0]);
    expect(onSort).toHaveBeenCalledWith('value');
  });

  it('calls onNextPage when next button clicked', async () => {
    const onNextPage = vi.fn();
    render(
      <DataTable columns={columns} data={data} sort={sort} hasNextPage onNextPage={onNextPage} onPrevPage={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onNextPage).toHaveBeenCalled();
  });

  it('calls onPrevPage when prev button clicked', async () => {
    const onPrevPage = vi.fn();
    render(
      <DataTable columns={columns} data={data} sort={sort} hasPrevPage onPrevPage={onPrevPage} onNextPage={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPrevPage).toHaveBeenCalled();
  });

  it('calls onRowClick when row clicked', async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} data={data} sort={sort} onRowClick={onRowClick} />);
    const rowButtons = screen.getAllByRole('button', { name: /view details/i });
    await userEvent.click(rowButtons[0]);
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('shows count label', () => {
    render(<DataTable columns={columns} data={data} sort={sort} totalCount={50} />);
    expect(screen.getByText(/showing 2 of 50/i)).toBeInTheDocument();
  });

  it('shows loading skeleton rows', () => {
    render(<DataTable columns={columns} data={[]} sort={sort} loading />);
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });
});
