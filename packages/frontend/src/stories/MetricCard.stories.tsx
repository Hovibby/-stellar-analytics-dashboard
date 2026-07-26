import type { Meta, StoryObj } from '@storybook/react';
import { Activity, TrendingUp, Database, Users } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';

/**
 * MetricCard — summary tile used on the Dashboard page.
 *
 * Accepts a Lucide icon, a numeric/string value, an optional change delta, and
 * a human-readable label for the trend row.
 */
const meta = {
  title: 'Components/MetricCard',
  component: MetricCard,
  tags: ['autodocs'],
  argTypes: {
    format: {
      control: 'select',
      options: ['number', 'currency', 'percentage'],
    },
    change: { control: 'number' },
    icon: { table: { disable: true } },
  },
} satisfies Meta<typeof MetricCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Base ─────────────────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    title: 'Total Transactions',
    value: 1_234_567,
    icon: Activity,
  },
};

// ── With positive trend ───────────────────────────────────────────────────────

export const PositiveTrend: Story = {
  args: {
    title: 'Active Accounts',
    value: 48_302,
    icon: Users,
    change: 5.2,
    changeLabel: '+5.2% from last week',
  },
};

// ── With negative trend ───────────────────────────────────────────────────────

export const NegativeTrend: Story = {
  args: {
    title: 'Average Fee (str)',
    value: 312,
    icon: TrendingUp,
    change: -2.1,
    changeLabel: '-2.1% from last week',
  },
};

// ── Neutral / zero change ─────────────────────────────────────────────────────

export const NeutralTrend: Story = {
  args: {
    title: 'Ledger Count',
    value: 50_000_000,
    icon: Database,
    change: 0,
    changeLabel: 'No change from yesterday',
  },
};

// ── Currency format ───────────────────────────────────────────────────────────

export const CurrencyFormat: Story = {
  args: {
    title: 'Total Volume (USD)',
    value: 9_821_044.5,
    icon: Activity,
    format: 'currency',
    change: 12,
    changeLabel: '+12% this month',
  },
};

// ── Percentage format ─────────────────────────────────────────────────────────

export const PercentageFormat: Story = {
  args: {
    title: 'Success Rate',
    value: 99.7,
    icon: Activity,
    format: 'percentage',
  },
};

// ── Large number ──────────────────────────────────────────────────────────────

export const LargeNumber: Story = {
  name: 'Large number (locale formatting)',
  args: {
    title: 'Operations',
    value: 12_345_678_901,
    icon: Database,
  },
};
