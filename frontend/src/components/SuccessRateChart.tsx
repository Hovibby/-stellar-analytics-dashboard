/**
 * SuccessRateChart (issue #250)
 *
 * Dedicated view of the successful/failed transaction ratio over time,
 * distinct from TransactionsChart's volume bars (which only color-code by
 * success rate rather than plotting the ratio itself).
 */
import { useQuery } from '@apollo/client';
import { useTranslation } from 'react-i18next';
import { NETWORK_METRICS_QUERY } from '../graphql/queries';

interface MetricPoint {
  timestamp: string;
  successRate: number;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SuccessRateChart() {
  const { t } = useTranslation();
  const now = new Date();
  const startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const { data, loading, error, refetch } = useQuery(NETWORK_METRICS_QUERY, {
    variables: { timeRange: { startTime, endTime: now.toISOString() } },
    pollInterval: 30_000,
    notifyOnNetworkStatusChange: true,
    errorPolicy: 'all',
  });

  const metrics: MetricPoint[] = (data?.networkMetrics ?? []).map((m: any) => ({
    timestamp: m.timestamp,
    successRate: m.successRate ?? 0,
  }));

  const heading = (
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
      {t('chart.successRateOverTime')}
    </h3>
  );

  if (loading && metrics.length === 0) {
    return (
      <section className="card" aria-busy="true" aria-label={t('chart.successRateOverTime')}>
        {heading}
        <div
          style={{
            height: '120px',
            background:
              'linear-gradient(90deg, var(--color-skeleton-start) 25%, var(--color-skeleton-end) 50%, var(--color-skeleton-start) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s infinite',
            borderRadius: '8px',
          }}
        />
      </section>
    );
  }

  if (error && metrics.length === 0) {
    return (
      <section className="card" role="alert">
        {heading}
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

  if (metrics.length === 0) {
    return (
      <section className="card">
        {heading}
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
          {t('chart.noData')}
        </p>
      </section>
    );
  }

  const avgSuccess = metrics.reduce((s, m) => s + m.successRate, 0) / metrics.length;
  const avgFailed = 100 - avgSuccess;

  return (
    <section className="card">
      {heading}

      {/* Stacked success/fail ratio bars per data point */}
      <div
        role="img"
        aria-label={`Success rate chart with ${metrics.length} data points, average ${avgSuccess.toFixed(1)}%`}
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '80px',
          padding: '0 4px',
        }}
      >
        {metrics.map((m, i) => (
          <div
            key={i}
            title={`${formatTime(m.timestamp)}: ${m.successRate.toFixed(1)}%`}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              height: '100%',
              minWidth: '2px',
            }}
          >
            <div
              style={{
                height: `${100 - m.successRate}%`,
                background: 'var(--color-error)',
                borderRadius: '2px 2px 0 0',
              }}
            />
            <div
              style={{
                height: `${m.successRate}%`,
                background: 'var(--color-primary)',
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
          {formatTime(metrics[0].timestamp)}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
          {formatTime(metrics[metrics.length - 1].timestamp)}
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '16px',
          marginTop: '12px',
          paddingTop: '12px',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: 'var(--color-primary)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {t('chart.successful')}: {avgSuccess.toFixed(1)}%
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '2px',
              background: 'var(--color-error)',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {t('chart.failed')}: {avgFailed.toFixed(1)}%
          </span>
        </div>
      </div>
    </section>
  );
}
