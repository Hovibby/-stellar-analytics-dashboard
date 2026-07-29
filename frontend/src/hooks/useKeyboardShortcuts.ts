import { useEffect } from 'react';

interface KeyboardShortcutsProps {
  onDashboard: () => void;
  onLedgers: () => void;
  onTransactions: () => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
}

export function useKeyboardShortcuts({
  onDashboard,
  onLedgers,
  onTransactions,
  onRefresh,
  onToggleTheme,
}: KeyboardShortcutsProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if user is typing in form inputs/textarea
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.altKey) {
        if (e.key === '1') {
          e.preventDefault();
          onDashboard();
        } else if (e.key === '2') {
          e.preventDefault();
          onLedgers();
        } else if (e.key === '3') {
          e.preventDefault();
          onTransactions();
        } else if (e.key.toLowerCase() === 'r') {
          e.preventDefault();
          onRefresh();
        } else if (e.key.toLowerCase() === 't') {
          e.preventDefault();
          onToggleTheme();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onDashboard, onLedgers, onTransactions, onRefresh, onToggleTheme]);
}
