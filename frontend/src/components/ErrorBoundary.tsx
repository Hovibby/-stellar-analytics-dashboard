/**
 * Global error boundary (issue #239)
 *
 * Catches unexpected render/lifecycle errors anywhere in the wrapped
 * subtree and shows a graceful fallback instead of an unmounted white
 * screen. React error boundaries must be class components — there is no
 * hook equivalent (as of React 18/19).
 *
 * Note: error boundaries do NOT catch errors in event handlers, async code
 * (promises/setTimeout), SSR, or errors thrown in the boundary itself. Those
 * are handled separately by GraphQL's own error states (see
 * useDashboardData / TransactionsList's error branches) and, for truly
 * unhandled async errors, a window 'error' / 'unhandledrejection' listener
 * would be the next layer — out of scope here since none of that surfaced
 * as an issue in this codebase yet.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional hook for reporting errors to an external service. */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

const fallbackStyles = {
  container: {
    maxWidth: '560px',
    margin: '48px auto',
    padding: '24px',
    fontFamily: '"Segoe UI", Arial, sans-serif',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '20px',
    fontWeight: 700,
    margin: '0 0 8px',
    color: '#102a43',
  },
  message: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 20px',
  },
  details: {
    textAlign: 'left' as const,
    fontSize: '12px',
    fontFamily: 'monospace',
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '20px',
    color: '#7f1d1d',
    overflowX: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  button: {
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: '14px',
    marginRight: '8px',
  },
  secondaryButton: {
    background: 'transparent',
    color: '#3b82f6',
    border: '1px solid #3b82f6',
    borderRadius: '8px',
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: '14px',
  },
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Always log locally so the error is visible in dev tools / server logs
    // even when no external reporting hook is configured.
    console.error('Unhandled UI error caught by ErrorBoundary:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    return (
      <div role="alert" style={fallbackStyles.container}>
        <h1 style={fallbackStyles.title}>Something went wrong</h1>
        <p style={fallbackStyles.message}>
          The dashboard hit an unexpected error and couldn't continue rendering. You can try
          again, or reload the page if the problem persists.
        </p>
        {import.meta.env.DEV && (
          <pre style={fallbackStyles.details}>{error.stack || error.message}</pre>
        )}
        <button style={fallbackStyles.button} onClick={this.handleReset}>
          Try again
        </button>
        <button style={fallbackStyles.secondaryButton} onClick={this.handleReload}>
          Reload page
        </button>
      </div>
    );
  }
}
