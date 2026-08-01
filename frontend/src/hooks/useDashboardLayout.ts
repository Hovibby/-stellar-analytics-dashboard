/**
 * useDashboardLayout (issue #231)
 *
 * Lets users reorder dashboard panels and toggle their visibility, and
 * persists the arrangement to localStorage so it survives reloads.
 */
import { useCallback, useEffect, useState } from 'react';

export type PanelId =
  | 'metrics'
  | 'transactionsChart'
  | 'successRateChart'
  | 'topAssets'
  | 'topAccounts';

export interface PanelConfig {
  id: PanelId;
  visible: boolean;
}

const STORAGE_KEY = 'stellar-analytics-dashboard-layout';

export const DEFAULT_LAYOUT: PanelConfig[] = [
  { id: 'metrics', visible: true },
  { id: 'transactionsChart', visible: true },
  { id: 'successRateChart', visible: true },
  { id: 'topAssets', visible: true },
  { id: 'topAccounts', visible: true },
];

function loadLayout(): PanelConfig[] {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as PanelConfig[];
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUT;

    // Reconcile with DEFAULT_LAYOUT so a newly-added panel (e.g. shipped in
    // a later release) still shows up for existing users instead of being
    // silently dropped because it's missing from their saved layout.
    const knownIds = new Set(DEFAULT_LAYOUT.map((p) => p.id));
    const savedIds = new Set(parsed.map((p) => p.id));
    const reconciled = parsed.filter((p) => knownIds.has(p.id));
    for (const panel of DEFAULT_LAYOUT) {
      if (!savedIds.has(panel.id)) reconciled.push(panel);
    }
    return reconciled.length > 0 ? reconciled : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useDashboardLayout() {
  const [layout, setLayout] = useState<PanelConfig[]>(DEFAULT_LAYOUT);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    setLayout(loadLayout());
    setIsInitialized(true);
  }, []);

  const persist = useCallback((next: PanelConfig[]) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Best-effort persistence; layout still works for this session.
    }
  }, []);

  const toggleVisibility = useCallback(
    (id: PanelId) => {
      persist(layout.map((p) => (p.id === id ? { ...p, visible: !p.visible } : p)));
    },
    [layout, persist]
  );

  const move = useCallback(
    (id: PanelId, direction: 'up' | 'down') => {
      const index = layout.findIndex((p) => p.id === id);
      if (index === -1) return;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= layout.length) return;

      const next = [...layout];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      persist(next);
    },
    [layout, persist]
  );

  const reset = useCallback(() => persist(DEFAULT_LAYOUT), [persist]);

  return { layout, isInitialized, toggleVisibility, move, reset };
}
