import type { Meta, StoryObj } from '@storybook/react';
import { SortableHeader } from '@/components/SortableHeader';

/**
 * SortableHeader — column header button used inside DataTable.
 *
 * Displays an up/down/neutral sort icon depending on whether this field is the
 * active sort key and what direction it is sorted.
 */
const meta = {
  title: 'Components/SortableHeader',
  component: SortableHeader,
  tags: ['autodocs'],
  argTypes: {
    onSort: { action: 'sorted' },
  },
  decorators: [
    (Story) => (
      <table>
        <thead>
          <tr>
            <th style={{ padding: '8px 12px', textAlign: 'left' }}>
              <Story />
            </th>
          </tr>
        </thead>
      </table>
    ),
  ],
} satisfies Meta<typeof SortableHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inactive: Story = {
  args: {
    label: 'Created At',
    field: 'created_at',
    sort: { field: 'sequence', dir: 'desc' },
  },
};

export const ActiveAscending: Story = {
  args: {
    label: 'Sequence',
    field: 'sequence',
    sort: { field: 'sequence', dir: 'asc' },
  },
};

export const ActiveDescending: Story = {
  args: {
    label: 'Fee Charged',
    field: 'fee_charged',
    sort: { field: 'fee_charged', dir: 'desc' },
  },
};
