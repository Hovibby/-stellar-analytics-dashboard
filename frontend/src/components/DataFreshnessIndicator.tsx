/**
 * DataFreshnessIndicator component (issue #242)
 *
 * Displays when the last data update occurred for a dashboard section.
 * Shows a human-readable "time ago" format with visual indicators
 * based on data freshness (green for fresh, yellow for stale, red for very stale).
 */
import { useTranslation } from 'react-i18next';

interface DataFreshnessIndicatorProps {
  lastUpdated: string | null;
  label?: string;
}

export function DataFreshnessIndicator({ lastUpdated, label }: DataFreshnessIndicatorProps) {
  const { t, i18n } = useTranslation();

  if (!lastUpdated) {
    return null;
  }

  const now = new Date();
  const updated = new Date(lastUpdated);
  const diffMs = now.getTime() - updated.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let timeAgo: string;
  let freshnessColor: string;

  if (diffMins < 1) {
    timeAgo = t('freshness.justNow');
    freshnessColor = 'var(--color-success)';
  } else if (diffMins < 60) {
    timeAgo = t('freshness.minutesAgo', { count: diffMins });
    freshnessColor = diffMins < 5 ? 'var(--color-success)' : 'var(--color-warning)';
  } else if (diffHours < 24) {
    timeAgo = t('freshness.hoursAgo', { count: diffHours });
    freshnessColor = diffHours < 2 ? 'var(--color-warning)' : 'var(--color-error)';
  } else {
    timeAgo = t('freshness.daysAgo', { count: diffDays });
    freshnessColor = 'var(--color-error)';
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: freshnessColor,
          animation: 'pulse 2s infinite',
        }}
      />
      {label && <span>{label}:</span>}
      <span>{timeAgo}</span>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
