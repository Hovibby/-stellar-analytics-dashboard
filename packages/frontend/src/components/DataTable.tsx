/**
 * DataTable
 *
 * Responsive data table with two rendering modes:
 * - Desktop (sm+): traditional table with sortable column headers
 * - Mobile (<sm): card-per-row layout showing all data without horizontal scroll
 *
 * The `mobileLabel` on each column controls the label shown in card mode.
 * Columns with `hideOnMobile: true` are omitted from the card layout.
 */
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { clsx } from 'clsx';
import type { SortState } from '@/hooks/useFilterSort';

interface Column<T> {
  header: string;
  accessor: keyof T | ((item: T) => React.ReactNode);
  className?: string;
  /** If provided, clicking the header sorts by this field */
  sortField?: string;
  /** Label shown in mobile card layout (defaults to header) */
  mobileLabel?: string;
  /** Hide this column in the mobile card layout */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  sort?: SortState;
  onSort?: (field: string) => void;
  totalCount?: number;
  onRowClick?: (item: T) => void;
  caption?: string;
}

export function DataTable<T>({
  columns,
  data,
  loading,
  onNextPage,
  onPrevPage,
  hasNextPage,
  hasPrevPage,
  sort,
  onSort,
  totalCount,
  onRowClick,
  caption,
}: DataTableProps<T>) {
  const countLabel =
    totalCount !== undefined
      ? `Showing ${data.length} of ${totalCount.toLocaleString()}`
      : `Showing ${data.length} results`;

  // Columns visible in mobile card layout
  const mobileColumns = columns.filter((c) => !c.hideOnMobile);

  const skeletonRows = [...Array(5)];

  // Varying skeleton widths to simulate realistic data shapes
  const skeletonWidths = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-1/3', 'w-4/5'];
  const skeletonWidth = (row: number, col: number) =>
    skeletonWidths[(row * 3 + col * 2) % skeletonWidths.length];

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">

      {/* ── Desktop table (sm and up) ─────────────────────────────────── */}
      <div className="hidden sm:block overflow-x-auto">
        <table
          className="w-full text-left border-collapse"
          aria-label={caption}
          aria-rowcount={totalCount}
          aria-busy={loading}
        >
          {caption && <caption className="sr-only">{caption}</caption>}

          <thead>
            <tr className="border-b border-border bg-muted/30">
              {columns.map((col, i) => {
                const isSortable = !!col.sortField && !!onSort;
                const isActive = sort?.field === col.sortField;
                const sortDir = isActive ? sort!.dir : undefined;

                return (
                  <th
                    key={i}
                    scope="col"
                    aria-sort={
                      isSortable
                        ? isActive
                          ? sortDir === 'asc' ? 'ascending' : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={clsx(
                      'px-4 py-3 lg:px-6 lg:py-4',
                      isSortable && 'cursor-pointer select-none hover:bg-muted/50 transition-colors',
                      col.className
                    )}
                    onClick={isSortable ? () => onSort!(col.sortField!) : undefined}
                    onKeyDown={
                      isSortable
                        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort!(col.sortField!); } }
                        : undefined
                    }
                    tabIndex={isSortable ? 0 : undefined}
                    role={isSortable ? 'button' : undefined}
                    aria-label={
                      isSortable
                        ? `Sort by ${col.header}${isActive ? `, currently ${sortDir === 'asc' ? 'ascending' : 'descending'}` : ''}`
                        : undefined
                    }
                  >
                    <div className="flex items-center gap-1.5 group">
                      <span
                        className={clsx(
                          'text-xs uppercase tracking-wider font-semibold transition-colors',
                          isActive ? 'text-foreground' : 'text-muted-foreground',
                          isSortable && 'group-hover:text-foreground'
                        )}
                      >
                        {col.header}
                      </span>
                      {isSortable && (
                        <span className="shrink-0" aria-hidden="true">
                          {isActive ? (
                            sortDir === 'asc'
                              ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
                              : <ArrowDown className="h-3.5 w-3.5 text-primary" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-30 group-hover:opacity-60 transition-opacity" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {loading ? (
              skeletonRows.map((_, i) => (
                <tr key={i} aria-hidden="true">
                  {columns.map((_, j) => (
                    <td key={j} className="px-4 py-3 lg:px-6 lg:py-4">
                      <div
                        className={clsx(
                          'h-4 bg-muted rounded animate-pulse',
                          skeletonWidth(i, j)
                        )}
                        style={{ animationDelay: `${i * 80}ms` }}
                      />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-6 py-12 text-center text-sm text-muted-foreground"
                >
                  No results found
                </td>
              </tr>
            ) : (
              data.map((item, i) => (
                <motion.tr
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  key={i}
                  onClick={onRowClick ? () => onRowClick(item) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(item); } }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                  aria-label={onRowClick ? 'View details' : undefined}
                  className={clsx(
                    'hover:bg-muted/50 transition-colors',
                    onRowClick && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
                  )}
                >
                  {columns.map((col, j) => (
                    <td key={j} className={clsx('px-4 py-3 lg:px-6 lg:py-4 text-sm', col.className)}>
                      {typeof col.accessor === 'function'
                        ? col.accessor(item)
                        : (item[col.accessor] as React.ReactNode)}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Mobile card layout (below sm) ────────────────────────────── */}
      <div className="sm:hidden divide-y divide-border" aria-label={caption} aria-busy={loading}>
        {loading ? (
          skeletonRows.map((_, i) => (
            <div key={i} className="p-4 space-y-2" aria-hidden="true" style={{ animationDelay: `${i * 80}ms` }}>
              <div className="flex items-center justify-between gap-2">
                <div className={clsx('h-4 bg-muted rounded animate-pulse', skeletonWidths[(i * 2) % skeletonWidths.length])} />
                <div className="h-4 w-4 bg-muted rounded animate-pulse" />
              </div>
              <div className={clsx('h-3 bg-muted rounded animate-pulse', skeletonWidths[(i * 2 + 1) % skeletonWidths.length])} />
              <div className={clsx('h-3 bg-muted rounded animate-pulse', skeletonWidths[(i * 2 + 3) % skeletonWidths.length])} />
            </div>
          ))
        ) : data.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            No results found
          </div>
        ) : (
          data.map((item, i) => (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              key={i}
              onClick={onRowClick ? () => onRowClick(item) : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(item); } }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
              aria-label={onRowClick ? 'View details' : undefined}
              className={clsx(
                'p-4 space-y-2 transition-colors',
                onRowClick && 'cursor-pointer hover:bg-muted/50 active:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'
              )}
            >
              {mobileColumns.map((col, j) => {
                const value = typeof col.accessor === 'function'
                  ? col.accessor(item)
                  : (item[col.accessor] as React.ReactNode);
                const label = col.mobileLabel ?? col.header;

                // First column gets prominent treatment
                if (j === 0) {
                  return (
                    <div key={j} className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0 text-sm font-medium">{value}</div>
                      {onRowClick && (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                      )}
                    </div>
                  );
                }

                return (
                  <div key={j} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 w-24">{label}</span>
                    <span className="text-right flex-1 min-w-0">{value}</span>
                  </div>
                );
              })}
            </motion.div>
          ))
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border flex items-center justify-between bg-muted/10 gap-2">
        <p className="text-xs sm:text-sm text-muted-foreground" aria-live="polite" aria-atomic="true">
          {countLabel}
        </p>
        <nav aria-label="Table pagination">
          <div className="flex gap-2">
            <button
              disabled={!hasPrevPage || loading}
              onClick={onPrevPage}
              aria-label="Previous page"
              className="p-2.5 rounded-lg border border-border hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              disabled={!hasNextPage || loading}
              onClick={onNextPage}
              aria-label="Next page"
              className="p-2.5 rounded-lg border border-border hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
            >
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
