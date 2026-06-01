import { useState } from 'react';
import { useQuery } from '@apollo/client';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, XCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TRANSACTIONS_QUERY } from '@/graphql/queries';

const PAGE_SIZE = 10;

const SKELETON_ROWS = Array.from({ length: PAGE_SIZE });

function TransactionSkeleton() {
  return (
    <>
      {SKELETON_ROWS.map((_, i) => (
        <tr key={i} aria-hidden="true" className="animate-pulse">
          <td className="px-6 py-4"><div className="h-5 w-5 bg-muted rounded-full" /></td>
          <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-28" /></td>
          <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-16" /></td>
          <td className="px-6 py-4"><div className="h-4 bg-muted rounded w-24" /></td>
          <td className="px-6 py-4 text-right"><div className="h-4 bg-muted rounded w-20 ml-auto" /></td>
        </tr>
      ))}
    </>
  );
}

export function RecentTransactions() {
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, loading, error, fetchMore } = useQuery(TRANSACTIONS_QUERY, {
    variables: { first: PAGE_SIZE },
  });

  if (error) {
    return (
      <div
        role="alert"
        className="p-4 text-destructive bg-destructive/10 rounded-lg"
      >
        Failed to load transactions: {error.message}
      </div>
    );
  }

  const transactions = data?.transactions?.edges || [];
  const pageInfo = data?.transactions?.pageInfo;
  const totalCount = data?.transactions?.totalCount;

  const handleLoadMore = async () => {
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) return;
    setLoadingMore(true);
    try {
      await fetchMore({
        variables: { first: PAGE_SIZE, after: pageInfo.endCursor },
        updateQuery: (prev: any, { fetchMoreResult }: any) => {
          if (!fetchMoreResult) return prev;
          return {
            transactions: {
              ...fetchMoreResult.transactions,
              edges: [...prev.transactions.edges, ...fetchMoreResult.transactions.edges],
            },
          };
        },
      });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section aria-labelledby="recent-tx-heading" className="chart-container overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <h2 id="recent-tx-heading" className="text-lg font-semibold">
          Recent Transactions
          {totalCount !== undefined && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({transactions.length} of {totalCount.toLocaleString()})
            </span>
          )}
        </h2>
        <Link
          to="/transactions"
          className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 font-medium"
          aria-label="View all transactions"
        >
          View all <ExternalLink size={14} aria-hidden="true" />
        </Link>
      </div>

      <div className="overflow-x-auto -mx-6" role="region" aria-label="Recent transactions table">
        <table
          className="w-full text-left border-collapse min-w-[600px]"
          aria-label="Recent transactions"
        >
          <thead>
            <tr className="text-muted-foreground text-xs uppercase tracking-wider border-b border-border bg-muted/30">
              <th scope="col" className="px-6 py-3 font-semibold">Status</th>
              <th scope="col" className="px-6 py-3 font-semibold">Hash</th>
              <th scope="col" className="px-6 py-3 font-semibold">Ledger</th>
              <th scope="col" className="px-6 py-3 font-semibold">Source</th>
              <th scope="col" className="px-6 py-3 font-semibold text-right">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading ? (
              <TransactionSkeleton />
            ) : (
              transactions.map(({ node: tx }: any) => (
                <tr key={tx.hash} className="hover:bg-muted/50 transition-colors group">
                  <td className="px-6 py-4">
                    {tx.successful ? (
                      <CheckCircle2
                        className="h-5 w-5 text-green-500"
                        aria-label="Successful"
                      />
                    ) : (
                      <XCircle
                        className="h-5 w-5 text-red-500"
                        aria-label="Failed"
                      />
                    )}
                  </td>
                  <td className="px-6 py-4 font-mono text-sm">
                    <Link
                      to={`/transactions/${tx.hash}`}
                      className="text-primary hover:underline truncate w-32 block"
                      aria-label={`Transaction ${tx.hash}`}
                    >
                      {tx.hash.substring(0, 12)}...
                    </Link>
                  </td>
                  <td className="px-6 py-4 text-sm font-medium">{tx.ledger}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    <span aria-label={`Source account ${tx.sourceAccount}`}>
                      {tx.sourceAccount.substring(0, 4)}...{tx.sourceAccount.substring(52)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground text-right whitespace-nowrap">
                    <time dateTime={tx.createdAt}>
                      {formatDistanceToNow(new Date(tx.createdAt), { addSuffix: true })}
                    </time>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!loading && pageInfo?.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border hover:bg-muted/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Load more transactions"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading…
              </>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}
    </section>
  );
}
