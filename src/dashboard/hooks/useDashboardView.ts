import { useState, useCallback, useMemo } from 'react';

export type ViewMode = 'single' | 'comparison' | 'scorecard';

export interface DateRangeFilter {
  from: string | null; // ISO date string
  to: string | null;
}

export interface DashboardFilters {
  dateRange: DateRangeFilter;
  accountIds: string[];
}

export interface FilterErrors {
  dateRange?: string;
  accountIds?: string;
}

interface OptimisticAction<T> {
  id: string;
  apply: (current: T) => T;
  rollback: (previous: T) => T;
}

const MAX_COMPARISON_ACCOUNTS = 5;

function validateFilters(filters: DashboardFilters): FilterErrors {
  const errors: FilterErrors = {};

  const { from, to } = filters.dateRange;
  if (from && to) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
      errors.dateRange = 'Enter valid dates.';
    } else if (fromDate > toDate) {
      errors.dateRange = '"From" date must be before "To" date.';
    }
  } else if (from || to) {
    errors.dateRange = 'Select both a start and end date.';
  }

  if (filters.accountIds.length === 0) {
    errors.accountIds = 'Select at least one account.';
  } else if (filters.accountIds.length > MAX_COMPARISON_ACCOUNTS) {
    errors.accountIds = `Select up to ${MAX_COMPARISON_ACCOUNTS} accounts.`;
  }

  return errors;
}

/**
 * Centralizes dashboard filter state, view mode, and optimistic UI
 * transitions for quick actions (filter changes, view switches).
 */
export function useDashboardView(initialFilters?: Partial<DashboardFilters>) {
  const [filters, setFilters] = useState<DashboardFilters>({
    dateRange: { from: null, to: null },
    accountIds: [],
    ...initialFilters,
  });

  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  const errors = useMemo(() => validateFilters(filters), [filters]);
  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors]);

  const updateDateRange = useCallback((range: DateRangeFilter) => {
    setFilters((prev) => ({ ...prev, dateRange: range }));
  }, []);

  const updateAccountIds = useCallback((accountIds: string[]) => {
    setFilters((prev) => ({ ...prev, accountIds }));
  }, []);

  /**
   * Switches view mode immediately (optimistically), and auto-selects
   * a sane view mode based on account selection where relevant.
   */
  const switchView = useCallback((mode: ViewMode) => {
    setViewMode(mode);
  }, []);

  /**
   * Runs an optimistic update: applies immediately, then calls `commit`.
   * If `commit` rejects, rolls back to the previous filter state.
   */
  const runOptimisticAction = useCallback(
    async <T,>(action: OptimisticAction<DashboardFilters>, commit: () => Promise<T>) => {
      setPendingActionId(action.id);
      const previous = filters;
      setFilters((current) => action.apply(current));

      try {
        const result = await commit();
        return result;
      } catch (err) {
        setFilters(() => action.rollback(previous));
        throw err;
      } finally {
        setPendingActionId(null);
      }
    },
    [filters]
  );

  const isComparisonEligible = filters.accountIds.length > 1;

  return {
    filters,
    errors,
    isValid,
    viewMode,
    pendingActionId,
    isComparisonEligible,
    updateDateRange,
    updateAccountIds,
    switchView,
    runOptimisticAction,
  };
}