/**
 * useUrlTab
 *
 * Syncs a tab selection to the URL search params so users can bookmark and
 * share links to a specific tab on a page.
 *
 * Usage:
 *   const [activeTab, setActiveTab] = useUrlTab<'overview' | 'operations' | 'xdr'>(
 *     'tab',
 *     'overview',
 *   );
 *
 * The first argument is the URL param name (e.g. "tab"), and the second is the
 * default (fallback) value used when the param is absent or invalid.
 *
 * When the user navigates to ?tab=operations the hook returns 'operations'.
 * When setActiveTab('xdr') is called the URL is updated to ?tab=xdr
 * (using history.replaceState so the browser back-button is not polluted).
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useUrlTab<T extends string>(
  paramName: string,
  defaultTab: T,
  validTabs?: readonly T[],
): [T, (tab: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawParam = searchParams.get(paramName) as T | null;

  // Validate against the allowed set when provided; fall back to default.
  const activeTab: T =
    rawParam !== null &&
    (validTabs === undefined || (validTabs as readonly string[]).includes(rawParam))
      ? rawParam
      : defaultTab;

  const setActiveTab = useCallback(
    (tab: T) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === defaultTab) {
            // Remove the param when it equals the default to keep URLs clean.
            next.delete(paramName);
          } else {
            next.set(paramName, tab);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, paramName, defaultTab],
  );

  return [activeTab, setActiveTab];
}
