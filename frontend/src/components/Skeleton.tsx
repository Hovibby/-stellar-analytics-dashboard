/**
 * Skeleton components for loading states (issue #228)
 *
 * Provides reusable skeleton UI components to improve perceived performance
 * while data is being fetched. Supports both light and dark themes.
 */

export interface CardSkeletonProps {
  /** Number of skeleton cards to render */
  count?: number;
  /** Optional custom class name */
  className?: string;
}

/**
 * Card skeleton for dashboard metrics and similar card-based layouts
 */
export function CardSkeleton({ count = 4, className = '' }: CardSkeletonProps) {
  return (
    <div className={`skeleton-grid ${className}`} aria-busy="true">
      {[...Array(count)].map((_, i) => (
        <article key={i} className="card skeleton-card">
          <div className="skeleton-line skeleton-line-title" />
          <div className="skeleton-line skeleton-line-value" />
        </article>
      ))}
    </div>
  );
}

export interface TableRowSkeletonProps {
  /** Number of skeleton rows to render */
  count?: number;
  /** Number of columns in each row */
  columns?: number;
  /** Optional custom class name */
  className?: string;
}

/**
 * Table row skeleton for list views (LedgersList, TransactionsList)
 */
export function TableRowSkeleton({ count = 5, columns = 5, className = '' }: TableRowSkeletonProps) {
  return (
    <div className={`skeleton-table ${className}`} aria-busy="true">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="skeleton-row">
          {[...Array(columns)].map((_, j) => (
            <div key={j} className="skeleton-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface ChartSkeletonProps {
  /** Height of the skeleton chart */
  height?: string;
  /** Optional custom class name */
  className?: string;
}

/**
 * Chart skeleton for TransactionsChart and other chart components
 */
export function ChartSkeleton({ height = '120px', className = '' }: ChartSkeletonProps) {
  return (
    <div className={`skeleton-chart ${className}`} style={{ height }} aria-busy="true">
      <div className="skeleton-chart-bar" />
    </div>
  );
}

export interface TextLineSkeletonProps {
  /** Width of the skeleton line (CSS value) */
  width?: string;
  /** Height of the skeleton line (CSS value) */
  height?: string;
  /** Optional custom class name */
  className?: string;
}

/**
 * Single text line skeleton for generic text loading states
 */
export function TextLineSkeleton({ width = '100%', height = '14px', className = '' }: TextLineSkeletonProps) {
  return <div className={`skeleton-line ${className}`} style={{ width, height }} />;
}
