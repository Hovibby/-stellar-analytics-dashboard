/**
 * TransactionsList component with pagination support
 *
 * Displays a paginated list of transactions using cursor-based pagination
 * from the GraphQL API.
 * Includes data freshness indicator (issue #242).
 */
import { useQuery } from '@apollo/client';
import { TRANSACTIONS_QUERY } from '../graphql/queries';
import { useDataFreshness } from '../hooks/useDataFreshness';
import { DataFreshnessIndicator } from './DataFreshnessIndicator';
import { Pagination, PageInfo } from './Pagination';
import { TableRowSkeleton } from './Skeleton';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface TransactionEdge {
  cursor: string;
  node: {
    id: string;
    hash: string;
    successful: boolean;
    ledger: number;
    createdAt: string;
    sourceAccount: string;
    feeCharged: number;
    operationCount: number;
  };
}

interface TransactionsData {
  transactions: {
    edges: TransactionEdge[];
    pageInfo: PageInfo;
    totalCount: number;
  };
}

export interface TransactionsListProps {
  /** Issue #230: pre-filter to a time window (e.g. from a chart drill-down). */
  initialTimeRange?: { startTime: string; endTime: string } | null;
  /** Called when the user clears the active drill-down time range. */
  onClearTimeRange?: () => void;
}

export function TransactionsList({ initialTimeRange, onClearTimeRange }: TransactionsListProps = {}) {
  const { t, i18n } = useTranslation();
  const { data: freshnessData } = useDataFreshness();
  const [pageSize, setPageSize] = useState(25);
  const [after, setAfter] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<string[]>([]);

  const { data, loading, error, refetch } = useQuery<TransactionsData>(TRANSACTIONS_QUERY, {
    variables: {
      first: pageSize,
      after,
      timeRange: initialTimeRange ?? undefined,
    },
    notifyOnNetworkStatusChange: true,
  });

  // Reset pagination whenever the drill-down time range changes (a new
  // filter should always start from the first page).
  useEffect(() => {
    setAfter(null);
    setPreviousCursors([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTimeRange?.startTime, initialTimeRange?.endTime]);

  const transactions = data?.transactions.edges.map((edge) => edge.node) || [];
  const pageInfo = data?.transactions.pageInfo || { hasNextPage: false, endCursor: null };
  const totalCount = data?.transactions.totalCount || 0;

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setAfter(null);
    setPreviousCursors([]);
  };

  const handleLoadNext = (cursor: string | null) => {
    if (cursor && pageInfo.hasNextPage) {
      setPreviousCursors([...previousCursors, after || '']);
      setAfter(cursor);
    }
  };

  const handleLoadPrevious = () => {
    if (previousCursors.length > 0) {
      const newPreviousCursors = previousCursors.slice(0, -1);
      setPreviousCursors(newPreviousCursors);
      setAfter(newPreviousCursors[newPreviousCursors.length - 1] || null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString(i18n.language);
  };

  const formatHash = (hash: string) => {
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  const formatAccount = (account: string) => {
    return `${account.slice(0, 8)}...${account.slice(-8)}`;
  };

  if (loading && !data) {
    return (
      <section className="card" aria-busy="true">
        <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>
          {t('transactions.title')}
        </h3>
        <TableRowSkeleton count={5} columns={8} />
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="card" role="alert">
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 700 }}>
          {t('transactions.title')}
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-error)' }}>{error.message}</p>
      </section>
    );
  }

  const formatRangeBound = (iso: string) => new Date(iso).toLocaleString(i18n.language);

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
        }}
      >
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>
          {t('transactions.title')}
        </h3>
        <DataFreshnessIndicator
          lastUpdated={freshnessData?.transactionsLastUpdated || null}
        />
      </div>

      {initialTimeRange && (
        <div
          role="status"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            background: 'var(--color-warning-bg)',
            border: '1px solid var(--color-warning-border)',
            borderRadius: '8px',
            padding: '8px 12px',
            marginBottom: '16px',
            fontSize: '13px',
          }}
        >
          <span style={{ color: 'var(--color-warning-text)' }}>
            {t('transactions.filteredByDrillDown', {
              from: formatRangeBound(initialTimeRange.startTime),
              to: formatRangeBound(initialTimeRange.endTime),
            })}
          </span>
          {onClearTimeRange && (
            <button
              onClick={onClearTimeRange}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-warning-border)',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
                color: 'var(--color-warning-text)',
                fontSize: '12px',
              }}
            >
              {t('transactions.clearFilter')}
            </button>
          )}
        </div>
      )}

      {transactions.length === 0 ? (
        <EmptyState message={t('transactions.noData')} />
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '13px',
              }}
            >
              <thead>
                <tr
                  style={{
                    borderBottom: '2px solid var(--color-border-light)',
                    textAlign: 'left',
                  }}
                >
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.hash')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.status')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.ledger')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.sourceAccount')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.fee')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.operations')}
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      fontWeight: 600,
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {t('transactions.createdAt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    style={{
                      borderBottom: '1px solid var(--color-border-light)',
                    }}
                  >
                    <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                      {formatHash(tx.hash)}
                    </td>
                    <td style={{ padding: '8px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: tx.successful
                            ? 'var(--color-success-bg)'
                            : 'var(--color-error-bg)',
                          color: tx.successful ? 'var(--color-success)' : 'var(--color-error)',
                        }}
                      >
                        {tx.successful ? t('transactions.success') : t('transactions.failed')}
                      </span>
                    </td>
                    <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>
                      #{tx.ledger}
                    </td>
                    <td style={{ padding: '8px', fontFamily: 'monospace' }}>
                      {formatAccount(tx.sourceAccount)}
                    </td>
                    <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>
                      {tx.feeCharged.toLocaleString(i18n.language)} str
                    </td>
                    <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>
                      {tx.operationCount}
                    </td>
                    <td style={{ padding: '8px', color: 'var(--color-text-secondary)' }}>
                      {formatDate(tx.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            totalCount={totalCount}
            pageInfo={pageInfo}
            pageSize={pageSize}
            onPageSizeChange={handlePageSizeChange}
            onLoadNext={handleLoadNext}
            onLoadPrevious={handleLoadPrevious}
            currentCursor={after}
            previousCursors={previousCursors}
          />
        </>
      )}
    </section>
  );
}
