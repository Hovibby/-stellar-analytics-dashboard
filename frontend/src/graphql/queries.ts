/**
 * GraphQL query documents (issue #49)
 */
import { gql } from "@apollo/client";

export const STATS_QUERY = gql`
  query GetStats {
    stats {
      totalLedgers
      totalTransactions
      totalOperations
      totalAccounts
      totalAssets
      activeAccounts24h
      volume24h
      averageFee24h
      successRate24h
      latestLedger
      latestLedgerTime
    }
  }
`;

export const LEDGERS_QUERY = gql`
  query GetLedgers($first: Int, $after: String) {
    ledgers(pagination: { first: $first, after: $after }) {
      edges {
        cursor
        node {
          id
          sequence
          successfulTransactionCount
          failedTransactionCount
          operationCount
          closedAt
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export const TRANSACTIONS_QUERY = gql`
  query GetTransactions($first: Int, $after: String) {
    transactions(pagination: { first: $first, after: $after }) {
      edges {
        cursor
        node {
          id
          hash
          successful
          ledger
          createdAt
          sourceAccount
          feeCharged
          operationCount
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
      totalCount
    }
  }
`;

export const NETWORK_METRICS_QUERY = gql`
  query GetNetworkMetrics($timeRange: TimeRangeInput) {
    networkMetrics(timeRange: $timeRange) {
      timestamp
      transactionCount
      operationCount
      activeAccounts
      totalVolume
      averageFee
      successRate
    }
  }
`;

export const DATA_FRESHNESS_QUERY = gql`
  query GetDataFreshness {
    dataFreshness {
      ledgersLastUpdated
      transactionsLastUpdated
      operationsLastUpdated
      dashboardLastUpdated
    }
  }
`;
