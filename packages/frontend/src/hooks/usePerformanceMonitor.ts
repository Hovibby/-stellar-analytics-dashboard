/**
 * usePerformanceMonitor
 *
 * A React hook that wraps Apollo Client's request pipeline and emits
 * in-app notifications when GraphQL operations or page navigations
 * take longer than configurable thresholds.
 *
 * Usage
 * -----
 *  // Mount once near the app root (e.g. in Layout or App):
 *  usePerformanceMonitor();
 *
 * Configuration (via localStorage overrides for dev convenience):
 *  VITE_PERF_WARN_MS      – warn threshold in ms   (default: 2000)
 *  VITE_PERF_CRITICAL_MS  – critical threshold in ms (default: 8000)
 *
 * The hook:
 *  1. Patches apollo-client's link chain via a custom ApolloLink to
 *     measure every operation's round-trip time.
 *  2. Uses the Web Performance Navigation Timing API to detect slow
 *     page (route) loads.
 *  3. Fires a toast notification via useNotifications() so operators
 *     see latency regressions immediately in the UI.
 */

import { useEffect, useRef } from 'react';
import { ApolloLink, Observable } from '@apollo/client';
import { apolloClient } from '@/graphql/apollo-client';
import { useNotifications } from './useNotifications';

const WARN_MS = Number(import.meta.env.VITE_PERF_WARN_MS ?? 2000);
const CRITICAL_MS = Number(import.meta.env.VITE_PERF_CRITICAL_MS ?? 8000);

// We only want to inject the timing link once per app lifetime.
let timingLinkInjected = false;

export function usePerformanceMonitor(): void {
  const { notify } = useNotifications();
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    // ── Apollo operation timing ───────────────────────────────────────────────
    if (!timingLinkInjected) {
      timingLinkInjected = true;

      const timingLink = new ApolloLink((operation, forward) => {
        const startMs = Date.now();
        const opName = operation.operationName || 'anonymous';

        return new Observable((observer) => {
          const sub = forward(operation).subscribe({
            next(value) {
              const durationMs = Date.now() - startMs;
              if (durationMs >= CRITICAL_MS) {
                notifyRef.current({
                  type: 'error',
                  title: 'Critical: Slow API response',
                  message: `"${opName}" took ${durationMs.toFixed(0)} ms (threshold: ${CRITICAL_MS} ms)`,
                });
              } else if (durationMs >= WARN_MS) {
                notifyRef.current({
                  type: 'warning',
                  title: 'Warning: Slow API response',
                  message: `"${opName}" took ${durationMs.toFixed(0)} ms (threshold: ${WARN_MS} ms)`,
                });
              }
              observer.next(value);
            },
            error(err) {
              observer.error(err);
            },
            complete() {
              observer.complete();
            },
          });
          return () => sub.unsubscribe();
        });
      });

      // Prepend the timing link so it wraps the entire chain.
      // Apollo's setLink is not public, so we patch the internal link ref.
      const existingLink = (apolloClient as any).link;
      if (existingLink) {
        (apolloClient as any).link = timingLink.concat(existingLink);
      }
    }

    // ── Navigation / page load timing ────────────────────────────────────────
    const checkNavigationTiming = () => {
      if (typeof window === 'undefined' || !window.performance?.getEntriesByType) return;

      const entries = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (!entries.length) return;

      const nav = entries[0];
      const loadMs = nav.loadEventEnd - nav.startTime;

      if (loadMs > 0 && loadMs >= CRITICAL_MS) {
        notifyRef.current({
          type: 'error',
          title: 'Critical: Slow page load',
          message: `Page load took ${loadMs.toFixed(0)} ms (threshold: ${CRITICAL_MS} ms)`,
        });
      } else if (loadMs > 0 && loadMs >= WARN_MS) {
        notifyRef.current({
          type: 'warning',
          title: 'Warning: Slow page load',
          message: `Page load took ${loadMs.toFixed(0)} ms (threshold: ${WARN_MS} ms)`,
        });
      }
    };

    // Run after initial paint
    if (document.readyState === 'complete') {
      checkNavigationTiming();
    } else {
      window.addEventListener('load', checkNavigationTiming, { once: true });
    }

    return () => {
      window.removeEventListener('load', checkNavigationTiming);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
