/**
 * TransactionsChart (issue #49)
 *
 * Fetches real transaction volume data from the GraphQL API via Apollo Client.
 * Handles loading, error, and empty states gracefully.
 * Falls back to a "no data" message when the API returns an empty array.
 */
import { useQuery } from '@apollo/client';
import { NETWORK_METRICS_QUERY } from '../graphql/queries';
import { ExportControls } from './ExportControls';
import { ChartSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';
import { useTranslation } from 'react-i18next';

interface MetricPoint {
  timestamp: string;
  transactionCount: number;
  operationCount: number;
  averageFee: number;
  successRate: number;
  isForecast?: boolean;
}

const forecastNextHours = (data: MetricPoint[], count: number = 3): MetricPoint[] => {
  if (data.length < 2) return [];

  // Linear regression on last 6 points
  const lastPoints = data.slice(-6);
  const n = lastPoints.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = lastPoints[i].transactionCount;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  const lastTimestamp = new Date(data[data.length - 1].timestamp).getTime();
  const stepMs = 60 * 60 * 1000; // 1 hour

  const forecasted: MetricPoint[] = [];
  for (let i = 1; i <= count; i++) {
    const x = n + i - 1;
    const projectedCount = Math.max(0, Math.round(slope * x + intercept));

    forecasted.push({
      timestamp: new Date(lastTimestamp + i * stepMs).toISOString(),
      transactionCount: projectedCount,
      operationCount: Math.round(projectedCount * 3.5),
      averageFee: data[data.length - 1].averageFee,
      successRate: 100, // assume perfect success rate for forecast
      isForecast: true,
    });
  }
  return forecasted;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export interface TransactionsChartProps {
  /**
   * Drill-down (issue #230): called with the [start, end) bucket bounds for
   * the data point the user activated (click, or Enter/Space when focused),
   * so the caller can e.g. switch to the Transactions tab pre-filtered to
   * that window.
   */
  onDrillDown?: (range: { startTime: string; endTime: string }) => void;
}

export function TransactionsChart({ onDrillDown }: TransactionsChartProps) {
  const { t, i18n } = useTranslation();
  const now = new Date();
  const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data, loading, error, refetch } = useQuery(NETWORK_METRICS_QUERY, {
    variables: { timeRange: { startTime, endTime: now.toISOString() } },
    pollInterval: 30_000,
    notifyOnNetworkStatusChange: true,
    errorPolicy: 'all',
  });

  const historicalMetrics: MetricPoint[] = (data?.networkMetrics ?? []).map((m: any) => ({
    timestamp: m.timestamp,
    transactionCount: m.transactionCount ?? 0,
    operationCount: m.operationCount ?? 0,
    averageFee: m.averageFee ?? 0,
    successRate: m.successRate ?? 0,
  }));

  const forecastMetrics = forecastNextHours(historicalMetrics);
  const metrics = [...historicalMetrics, ...forecastMetrics];

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading && metrics.length === 0) {
    return (
      <section className="card" aria-busy="true" aria-label="Loading transaction chart">
        <h3
          style={{
            margin: '0 0 12px',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('chart.transactionVolume24h')}
        </h3>
        <ChartSkeleton height="120px" />
      </section>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error && metrics.length === 0) {
    return (
      <section className="card" role="alert">
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
          }}
        >
          Transaction Volume (24h)
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: '13px', color: 'var(--color-error)' }}>
          {error.message}
        </p>
        <button
          onClick={() => refetch()}
          style={{
            background: 'var(--color-input-disabled)',
            border: '1px solid var(--color-border)',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: '13px',
            color: 'var(--color-text-primary)',
          }}
        >
          {t('app.retry')}
        </button>
      </section>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (metrics.length === 0) {
    return (
      <section className="card">
        <h3
          style={{
            margin: '0 0 8px',
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('chart.transactionVolume24h')}
        </h3>
        <EmptyState message={t('chart.noData')} />
      </section>
    );
  }

  // ── Data ───────────────────────────────────────────────────────────────────
  const maxTx = Math.max(...metrics.map((m) => m.transactionCount), 1);

  // Issue #230: estimate each bar's [start, end) bucket from its neighbors so
  // drill-down works regardless of the points' sort order or bucket size.
  const bucketRangeFor = (index: number): { startTime: string; endTime: string } => {
    const t = new Date(metrics[index].timestamp).getTime();
    const neighbor = metrics[index + 1] ?? metrics[index - 1];
    const intervalMs = neighbor
      ? Math.abs(new Date(neighbor.timestamp).getTime() - t)
      : 60 * 60 * 1000;
    return {
      startTime: new Date(t - intervalMs / 2).toISOString(),
      endTime: new Date(t + intervalMs / 2).toISOString(),
    };
  };

  const handleActivate = (index: number) => {
    onDrillDown?.(bucketRangeFor(index));
  };

  return (
    <section className="card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-secondary)',
          }}
        >
          {t('chart.transactionVolume24h')}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Export controls for transaction metrics */}
          <ExportControls data={metrics} baseFilename="transaction-metrics" disabled={loading} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {loading && (
              <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                ↻ {t('chart.updating')}
              </span>
            )}
            <button
              onClick={() => refetch()}
              disabled={loading}
              aria-label={t('chart.refreshChart')}
              title={`${t('chart.refreshChart')} (Alt+r)`}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-border)',
                borderRadius: '6px',
                padding: '4px 8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                color: 'var(--color-text-secondary)',
              }}
            >
              ↻
            </button>
          </div>
        </div>
      </div>

      {/* Legend showing Historical vs Forecast */}
      <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--color-primary)', borderRadius: '1px' }}></span>
          <span>{t('chart.historical', 'Historical')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--color-primary)', border: '1px dashed currentColor', opacity: 0.55, borderRadius: '1px' }}></span>
          <span>{t('chart.expectedForecast', 'Expected (Forecast)')}</span>
        </div>
      </div>

      {/* Bar chart — each bar is a focusable, labeled button (issue #226:
          screen reader + keyboard support) that drills down into the
          underlying transactions for that time bucket (issue #230). */}
      <div
        role="group"
        aria-label={t('chart.ariaGroupLabel', { count: metrics.length })}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '80px',
          padding: '0 4px',
        }}
      >
        {metrics.map((m, i) => {
          const heightPct = (m.transactionCount / maxTx) * 100;
          return (
            <button
              key={i}
              type="button"
              onClick={() => handleActivate(i)}
              disabled={!onDrillDown || m.isForecast}
              title={`${formatTime(m.timestamp)}: ${m.transactionCount} txs${m.isForecast ? ` (${t('chart.forecast', 'Forecast')})` : ''}`}
              aria-label={t('chart.barAriaLabel', {
                time: formatTime(m.timestamp),
                count: m.transactionCount,
                successRate: m.successRate.toFixed(1),
              }) + (m.isForecast ? ` (${t('chart.forecast', 'Forecast')})` : '')}
              style={{
                flex: 1,
                height: `${Math.max(heightPct, 2)}%`,
                background:
                  m.successRate >= 99
                    ? 'var(--color-primary)'
                    : m.successRate >= 95
                      ? 'var(--color-warning)'
                      : 'var(--color-error)',
                border: m.isForecast ? '1px dashed currentColor' : 'none',
                borderRadius: '2px 2px 0 0',
                transition: 'height 0.3s ease, opacity 0.15s ease',
                minWidth: '2px',
                padding: 0,
                cursor: onDrillDown && !m.isForecast ? 'pointer' : 'default',
                opacity: m.isForecast ? 0.55 : 1,
              }}
              onMouseEnter={(e) => {
                if (onDrillDown && !m.isForecast) e.currentTarget.style.opacity = '0.75';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = m.isForecast ? '0.55' : '1';
              }}
            />
          );
        })}
      </div>

      {/* X-axis labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
          {formatTime(metrics[0].timestamp)}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
          {formatTime(metrics[metrics.length - 1].timestamp)}
        </span>
      </div>

      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {t('chart.totalTxs')}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700 }}>
            {metrics.reduce((s, m) => s + m.transactionCount, 0).toLocaleString(i18n.language)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {t('chart.avgFee')}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700 }}>
            {(metrics.reduce((s, m) => s + m.averageFee, 0) / metrics.length).toFixed(0)} str
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {t('chart.successRate')}
          </div>
          <div style={{ fontSize: '16px', fontWeight: 700 }}>
            {(metrics.reduce((s, m) => s + m.successRate, 0) / metrics.length).toFixed(1)}%
          </div>
        </div>
      </div>

      <p style={{ margin: '8px 0 0', fontSize: '10px', color: 'var(--color-text-disabled)' }}>
        {metrics.length} data points · {t('chart.autoRefresh')}
      </p>
    </section>
  );
}
