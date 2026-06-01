import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useFilterSort } from '../hooks/useFilterSort';
import type { ReactNode } from 'react';

const defaults = { search: '', isActive: '' as '' | 'true' | 'false' };
const sortDefaults = { field: 'createdAt', dir: 'desc' as const };

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('useFilterSort', () => {
  it('returns default filters initially', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    expect(result.current.filters).toEqual(defaults);
    expect(result.current.sort).toEqual(sortDefaults);
  });

  it('setFilter updates a filter value', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    act(() => {
      result.current.setFilter('search', 'hello');
    });
    expect(result.current.filters.search).toBe('hello');
  });

  it('setFilter with default value removes the param', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    act(() => {
      result.current.setFilter('search', 'hello');
    });
    act(() => {
      result.current.setFilter('search', '');
    });
    expect(result.current.filters.search).toBe('');
  });

  it('setSort toggles direction when same field', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    act(() => {
      result.current.setSort('createdAt');
    });
    expect(result.current.sort.dir).toBe('asc');
    act(() => {
      result.current.setSort('createdAt');
    });
    expect(result.current.sort.dir).toBe('desc');
  });

  it('setSort changes field and resets to asc', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    act(() => {
      result.current.setSort('name');
    });
    expect(result.current.sort.field).toBe('name');
    expect(result.current.sort.dir).toBe('asc');
  });

  it('resetFilters restores defaults', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    act(() => {
      result.current.setFilter('search', 'hello');
      result.current.setSort('name');
    });
    act(() => {
      result.current.resetFilters();
    });
    expect(result.current.filters).toEqual(defaults);
    expect(result.current.sort).toEqual(sortDefaults);
  });

  it('activeCount reflects number of non-default filters', () => {
    const { result } = renderHook(
      () => useFilterSort({ defaults, sortDefaults }),
      { wrapper }
    );
    expect(result.current.activeCount).toBe(0);
    act(() => {
      result.current.setFilter('search', 'hello');
    });
    expect(result.current.activeCount).toBe(1);
  });
});
