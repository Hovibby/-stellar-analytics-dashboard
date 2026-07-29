import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { MockedProvider } from '@apollo/client/testing';
import { TransactionsChart } from '@/components/TransactionsChart';
import { NETWORK_METRICS_QUERY } from '@/graphql/queries';

/**
 * TransactionsChart — bar chart showing 24-hour transaction volume.
 *
 * The component fetches from Apollo so we wrap it in `MockedProvider`.
 * States covered: Loading, Data, Mixed-success-rates, Empty, and Error.
 */

/** Build a realistic network-metrics data point. */
function makeMetric(hoursAgo: number, txCount: number, successRate = 99.5) {
  return {
    timestamp: new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString(),
    transactionCount: txCount,
    operationCount: txCount * 2,
    averageFee: 100,
    successRate,
  };
}

/** 24 hourly data points. */
const METRICS_DATA = Array.from({ length: 24 }, (_, i) =>
  makeMetric(23 - i, 400 + Math.round(Math.sin(i / 3) * 200))
);

// Because variables contain dynamic timestamps, we build a mock that matches
// any variables by providing a request matcher function via MockedProvider.
// Storybook's MockedProvider (from @apollo/client/testing) matches by deep
// equality, so we pre-build variables that cover "now ± a few ms".
function buildNowVars() {
  const now = new Date();
  const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  return { timeRange: { startTime, endTime: now.toISOString() } };
}

const dataMock = {
  request: { query: NETWORK_METRICS_QUERY, variables: buildNowVars() },
  result: { data: { networkMetrics: METRICS_DATA } },
};

const emptyMock = {
  request: { query: NETWORK_METRICS_QUERY, variables: buildNowVars() },
  result: { data: { networkMetrics: [] } },
};

const errorMock = {
  request: { query: NETWORK_METRICS_QUERY, variables: buildNowVars() },
  error: new Error('Failed to fetch network metrics — GraphQL service unreachable'),
};

const mixedMock = {
  request: { query: NETWORK_METRICS_QUERY, variables: buildNowVars() },
  result: {
    data: {
      networkMetrics: [
        ...Array.from({ length: 8 }, (_, i) => makeMetric(23 - i, 300, 99.8)),
        ...Array.from({ length: 8 }, (_, i) => makeMetric(15 - i, 500, 96.2)),
        ...Array.from({ length: 8 }, (_, i) => makeMetric(7 - i, 700, 91.0)),
      ],
    },
  },
};

const meta = {
  title: 'Components/TransactionsChart',
  component: TransactionsChart,
  tags: ['autodocs'],
  decorators: [
    (Story, context) => {
      const mocks = context.parameters.apolloMocks ?? [dataMock];
      return (
        <MockedProvider mocks={mocks} addTypename={false}>
          <Story />
        </MockedProvider>
      );
    },
  ],
  parameters: {
    docs: {
      description: {
        component:
          'Bar chart rendering 24 h of transaction-volume data sourced from Apollo. ' +
          'Each bar is coloured by success rate (green ≥ 99 %, amber ≥ 95 %, red below).',
      },
    },
  },
} satisfies Meta<typeof TransactionsChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  name: 'Loading skeleton',
  parameters: {
    apolloMocks: [{ request: { query: NETWORK_METRICS_QUERY, variables: buildNowVars() }, delay: Infinity }],
  },
};

export const WithData: Story = {
  name: 'With 24 h of data',
  parameters: { apolloMocks: [dataMock] },
};

export const LowSuccessRate: Story = {
  name: 'Degraded — mixed success rates',
  parameters: { apolloMocks: [mixedMock] },
};

export const Empty: Story = {
  name: 'Empty — no data returned',
  parameters: { apolloMocks: [emptyMock] },
};

export const Error: Story = {
  name: 'Error fetching data',
  parameters: { apolloMocks: [errorMock] },
};
