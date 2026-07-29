/**
 * useDataFreshness hook (issue #242)
 *
 * Fetches data freshness timestamps for each dashboard section.
 * Polls every 30 seconds to keep freshness indicators up to date.
 */
import { useQuery } from "@apollo/client";
import { DATA_FRESHNESS_QUERY } from "../graphql/queries";

export interface DataFreshness {
  ledgersLastUpdated: string;
  transactionsLastUpdated: string;
  operationsLastUpdated: string;
  dashboardLastUpdated: string;
}

export interface UseDataFreshnessResult {
  data: DataFreshness | null;
  loading: boolean;
  error: Error | null;
}

export function useDataFreshness(): UseDataFreshnessResult {
  const { data, loading, error } = useQuery(DATA_FRESHNESS_QUERY, {
    pollInterval: 30_000,
    notifyOnNetworkStatusChange: true,
    errorPolicy: "all",
  });

  const freshness = data?.dataFreshness;

  return {
    data: freshness || null,
    loading,
    error: error || null,
  };
}
