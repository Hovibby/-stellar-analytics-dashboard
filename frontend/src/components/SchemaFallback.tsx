export function SchemaFallback({ error, onDismiss }: { error: { message: string; details?: string }; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'var(--color-error-bg)',
        borderBottom: '1px solid var(--color-error-border)',
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--color-error)', marginBottom: 4, fontSize: '14px' }}>
          {error.message}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
          Current queries may be broken due to an API schema update.{' '}
          <a
            href="/docs/startup-troubleshooting"
            style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}
          >
            View troubleshooting docs
          </a>
          {error.details && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                Technical details
              </summary>
              <pre
                style={{
                  marginTop: 8,
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  background: 'var(--color-error-bg)',
                  border: '1px solid var(--color-error-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--color-error)',
                }}
              >
                {error.details}
              </pre>
            </details>
          )}
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: '1px solid var(--color-error-border)',
          borderRadius: '6px',
          padding: '4px 12px',
          cursor: 'pointer',
          color: 'var(--color-error)',
          fontSize: '13px',
          flexShrink: 0,
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
