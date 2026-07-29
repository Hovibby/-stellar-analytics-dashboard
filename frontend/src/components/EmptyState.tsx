/**
 * EmptyState component
 *
 * Consistent "no data yet" guidance for charts, tables, and panels, so
 * every empty dashboard section reads the same way instead of an ad-hoc
 * paragraph of muted text.
 */
export interface EmptyStateProps {
  /** Primary message explaining there's no data. */
  message: string;
  /** Optional secondary hint (e.g. what to do, or why data might be missing). */
  hint?: string;
}

export function EmptyState({ message, hint }: EmptyStateProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '32px 16px',
        gap: '8px',
      }}
    >
      <svg
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--color-text-tertiary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <path d="M8 14h.01M12 14h.01M16 14h.01" />
      </svg>
      <p
        style={{
          margin: 0,
          fontSize: '13px',
          color: 'var(--color-text-secondary)',
          maxWidth: '320px',
        }}
      >
        {message}
      </p>
      {hint && (
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            color: 'var(--color-text-tertiary)',
            maxWidth: '320px',
          }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
