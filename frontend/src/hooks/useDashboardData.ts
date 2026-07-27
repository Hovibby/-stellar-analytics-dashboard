/**
 * useDashboardData (issue #49)
 *
 * Replaces the hardcoded stub with a real Apollo Client query.
 * Provides:
 * - loading state
 * - error state with retry callback
 * - live stats from the GraphQL API
 * - automatic polling every 30 s
 */
import { useQuery } from "@apollo/client";
import { STATS_QUERY } from "../graphql/queries";
import { useLedgerAddedSubscription } from "./useLedgerAddedSubscription";

export interface DashboardStats {
  network: string;
  totalLedgers: number;
  totalTransactions: number;
  totalOperations: number;
  totalAccounts: number;
  totalAssets: number;
  activeAccounts24h: number;
  volume24h: string;
  averageFee24h: number;
  successRate24h: number;
  latestLedger: number | null;
  latestLedgerTime: string | null;
}

export interface UseDashboardDataResult {
  data: DashboardStats | null;
  loading: boolean;
  error: Error | null;
  /** Call to manually re-fetch after an error */
  retry: () => void;
}

const FALLBACK: DashboardStats = {
  network: "testnet",
  totalLedgers: 0,
  totalTransactions: 0,
  totalOperations: 0,
  totalAccounts: 0,
  totalAssets: 0,
  activeAccounts24h: 0,
  volume24h: "0",
  averageFee24h: 0,
  successRate24h: 0,
  latestLedger: null,
  latestLedgerTime: null,
};

export function useDashboardData(): UseDashboardDataResult {
  const { data, loading, error, refetch } = useQuery(STATS_QUERY, {
    // Poll every 30 s as a fallback so the dashboard stays fresh even if the
    // WebSocket subscription below is unavailable (proxy/firewall, etc.).
    pollInterval: 30_000,
    notifyOnNetworkStatusChange: true,
    // Return partial data while re-fetching so the UI doesn't blank out
    errorPolicy: "all",
  });

  // Issue #210: refresh immediately when the indexer commits a new ledger,
  // instead of waiting for the next 30s poll.
  useLedgerAddedSubscription(() => {
    void refetch();
  });

  const stats = data?.stats;

  const mapped: DashboardStats | null = stats
    ? {
        network: (import.meta as any).env?.VITE_STELLAR_NETWORK ?? "testnet",
        totalLedgers: stats.totalLedgers ?? 0,
        totalTransactions: stats.totalTransactions ?? 0,
        totalOperations: stats.totalOperations ?? 0,
        totalAccounts: stats.totalAccounts ?? 0,
        totalAssets: stats.totalAssets ?? 0,
        activeAccounts24h: stats.activeAccounts24h ?? 0,
        volume24h: stats.volume24h ?? "0",
        averageFee24h: stats.averageFee24h ?? 0,
        successRate24h: stats.successRate24h ?? 0,
        latestLedger: stats.latestLedger ?? null,
        latestLedgerTime: stats.latestLedgerTime ?? null,
      }
    : null;

  return {
    data: mapped ?? (loading ? null : FALLBACK),
    loading,
    error: error ?? null,
    retry: () => refetch(),
  };
}
