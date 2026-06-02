import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchHistory } from '../hooks/useSearchHistory';

beforeEach(() => {
  useSearchHistory.setState({ history: [] });
});

describe('useSearchHistory', () => {
  it('starts with empty history', () => {
    expect(useSearchHistory.getState().history).toHaveLength(0);
  });

  it('addEntry prepends a new entry', () => {
    useSearchHistory.getState().addEntry({ query: 'GABC', type: 'account' });
    const { history } = useSearchHistory.getState();
    expect(history).toHaveLength(1);
    expect(history[0].query).toBe('GABC');
    expect(history[0].type).toBe('account');
    expect(history[0].timestamp).toBeGreaterThan(0);
  });

  it('addEntry deduplicates by query', () => {
    useSearchHistory.getState().addEntry({ query: 'GABC', type: 'account' });
    useSearchHistory.getState().addEntry({ query: 'GABC', type: 'account' });
    expect(useSearchHistory.getState().history).toHaveLength(1);
  });

  it('addEntry moves existing query to front', () => {
    useSearchHistory.getState().addEntry({ query: 'first', type: 'general' });
    useSearchHistory.getState().addEntry({ query: 'second', type: 'general' });
    useSearchHistory.getState().addEntry({ query: 'first', type: 'general' });
    const { history } = useSearchHistory.getState();
    expect(history[0].query).toBe('first');
  });

  it('caps history at 20 entries', () => {
    for (let i = 0; i < 25; i++) {
      useSearchHistory.getState().addEntry({ query: `query-${i}`, type: 'general' });
    }
    expect(useSearchHistory.getState().history.length).toBeLessThanOrEqual(20);
  });

  it('removeEntry removes by query', () => {
    useSearchHistory.getState().addEntry({ query: 'GABC', type: 'account' });
    useSearchHistory.getState().removeEntry('GABC');
    expect(useSearchHistory.getState().history).toHaveLength(0);
  });

  it('clearHistory empties the list', () => {
    useSearchHistory.getState().addEntry({ query: 'a', type: 'general' });
    useSearchHistory.getState().addEntry({ query: 'b', type: 'general' });
    useSearchHistory.getState().clearHistory();
    expect(useSearchHistory.getState().history).toHaveLength(0);
  });
});
