import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLazyQuery } from '@apollo/client';
import {
  Search,
  ArrowRightLeft,
  Wallet,
  Database,
  Clock,
  X,
  Trash2,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatDistanceToNow } from 'date-fns';
import {
  SEARCH_ACCOUNTS_QUERY,
  SEARCH_TRANSACTIONS_QUERY,
  SEARCH_LEDGERS_QUERY,
} from '@/graphql/queries';
import { useSearchHistory } from '@/hooks/useSearchHistory';
import { getSearchHint } from '@/lib/validation';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Detect what kind of query the user typed */
function detectQueryType(q: string): 'account' | 'transaction' | 'ledger' | 'general' {
  const trimmed = q.trim();
  // Stellar account IDs start with G and are 56 chars
  if (/^G[A-Z2-7]{55}$/.test(trimmed)) return 'account';
  // Transaction hashes are 64 hex chars
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return 'transaction';
  // Pure number → ledger sequence
  if (/^\d+$/.test(trimmed)) return 'ledger';
  return 'general';
}

function truncate(str: string, start = 8, end = 8) {
  if (str.length <= start + end + 3) return str;
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface SearchResult {
  type: 'account' | 'transaction' | 'ledger';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export function GlobalSearch() {
  const navigate = useNavigate();
  const { history, addEntry, removeEntry, clearHistory } = useSearchHistory();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [searchAccounts] = useLazyQuery(SEARCH_ACCOUNTS_QUERY);
  const [searchTransactions] = useLazyQuery(SEARCH_TRANSACTIONS_QUERY);
  const [searchLedgers] = useLazyQuery(SEARCH_LEDGERS_QUERY);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Global keyboard shortcut: Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      const type = detectQueryType(q);
      const found: SearchResult[] = [];

      try {
        if (type === 'account' || type === 'general') {
          const { data } = await searchAccounts({
            variables: { filter: { accountId: q.trim() } },
          });
          const accounts = data?.accounts?.edges?.map((e: any) => e.node) ?? [];
          accounts.forEach((a: any) => {
            found.push({
              type: 'account',
              id: a.accountId,
              label: truncate(a.accountId, 10, 6),
              sublabel: `${parseFloat(a.balance).toLocaleString()} XLM`,
              href: `/accounts/${a.accountId}`,
            });
          });
        }

        if (type === 'transaction' || type === 'general') {
          // For hash search we fetch recent and filter client-side (API has no hash filter)
          const { data } = await searchTransactions({ variables: { first: 50 } });
          const txs = data?.transactions?.edges?.map((e: any) => e.node) ?? [];
          txs
            .filter((tx: any) => tx.hash.toLowerCase().includes(q.toLowerCase()))
            .slice(0, 5)
            .forEach((tx: any) => {
              found.push({
                type: 'transaction',
                id: tx.hash,
                label: truncate(tx.hash, 10, 8),
                sublabel: tx.successful ? 'Successful' : 'Failed',
                href: `/transactions/${tx.hash}`,
              });
            });
        }

        if (type === 'ledger' || type === 'general') {
          const { data } = await searchLedgers({ variables: { first: 20 } });
          const ledgers = data?.ledgers?.edges?.map((e: any) => e.node) ?? [];
          ledgers
            .filter((l: any) => String(l.sequence).includes(q))
            .slice(0, 5)
            .forEach((l: any) => {
              found.push({
                type: 'ledger',
                id: String(l.sequence),
                label: `Ledger #${l.sequence}`,
                sublabel: `${l.successfulTransactionCount} txs · ${l.operationCount} ops`,
                href: `/ledgers`,
              });
            });
        }
      } catch (_) {
        // silently ignore network errors in search
      }

      setResults(found);
      setSearching(false);
    },
    [searchAccounts, searchTransactions, searchLedgers]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIndex(-1);
    setOpen(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), 300);
  };

  const handleSelect = (result: SearchResult) => {
    addEntry({ query: result.id, type: result.type });
    setOpen(false);
    setQuery('');
    navigate(result.href);
  };

  const handleHistorySelect = (entry: { query: string; type: string }) => {
    const type = entry.type as SearchResult['type'];
    let href = '/';
    if (type === 'account') href = `/accounts/${entry.query}`;
    else if (type === 'transaction') href = `/transactions/${entry.query}`;
    else if (type === 'ledger') href = `/ledgers`;

    setOpen(false);
    setQuery('');
    navigate(href);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // If there's an active item, select it
    const allItems = results.length > 0 ? results : [];
    if (activeIndex >= 0 && activeIndex < allItems.length) {
      handleSelect(allItems[activeIndex]);
      return;
    }

    // Otherwise navigate to search page
    const type = detectQueryType(query);
    addEntry({ query: query.trim(), type });
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const total = results.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total > 0) setActiveIndex((i) => Math.min(i + 1, total - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total > 0) setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      handleSubmit(e as any);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showHistory = open && !query.trim() && history.length > 0;
  const showResults = open && query.trim().length > 0;

  const iconFor = (type: SearchResult['type']) => {
    if (type === 'account') return <Wallet className="h-4 w-4 text-blue-500" />;
    if (type === 'transaction') return <ArrowRightLeft className="h-4 w-4 text-green-500" />;
    return <Database className="h-4 w-4 text-purple-500" />;
  };

  const searchHint = getSearchHint(query);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <form onSubmit={handleSubmit}>
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search address / hash / ledger..."
            aria-label="Global search"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-describedby={searchHint ? 'global-search-hint' : undefined}
            className="w-full bg-muted/40 border border-transparent rounded-xl py-2 pl-10 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/30 transition-all placeholder:text-muted-foreground/60"
          />
          {/* Inline format hint shown below the input when dropdown is closed */}
          {searchHint && !open && (
            <p
              id="global-search-hint"
              className="absolute left-0 top-full mt-1 text-[10px] text-muted-foreground px-1"
              aria-live="polite"
            >
              {searchHint}
            </p>
          )}
          {/* Right side: loading / clear / shortcut hint */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            {query && !searching && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResults([]);
                  inputRef.current?.focus();
                }}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {!query && (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground/60 bg-muted/60 rounded border border-border/50">
                ⌘K
              </kbd>
            )}
          </div>
        </div>
      </form>

      {/* Dropdown */}
      {(showHistory || showResults) && (
        <div
          role="listbox"
          className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150 max-h-[70vh] overflow-y-auto"
        >
          {/* ── Search results ── */}
          {showResults && (
            <>
              {searching && results.length === 0 && (
                <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
                </div>
              )}

              {!searching && results.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No results for <span className="font-medium text-foreground">"{query}"</span>
                  <div className="mt-2">
                    <button
                      onClick={handleSubmit as any}
                      className="text-primary text-xs hover:underline"
                    >
                      View full search results →
                    </button>
                  </div>
                </div>
              )}

              {results.length > 0 && (
                <>
                  {/* Group by type */}
                  {(['account', 'transaction', 'ledger'] as const).map((type) => {
                    const group = results.filter((r) => r.type === type);
                    if (group.length === 0) return null;
                    const label =
                      type === 'account'
                        ? 'Accounts'
                        : type === 'transaction'
                          ? 'Transactions'
                          : 'Ledgers';
                    return (
                      <div key={type}>
                        <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground bg-muted/30 border-b border-border/50">
                          {label}
                        </div>
                        {group.map((result) => {
                          const idx = results.indexOf(result);
                          return (
                            <button
                              key={result.id}
                              role="option"
                              aria-selected={activeIndex === idx}
                              onClick={() => handleSelect(result)}
                              className={clsx(
                                'w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent transition-colors',
                                activeIndex === idx && 'bg-accent'
                              )}
                            >
                              {iconFor(result.type)}
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-mono font-medium truncate">
                                  {result.label}
                                </div>
                                {result.sublabel && (
                                  <div className="text-xs text-muted-foreground">
                                    {result.sublabel}
                                  </div>
                                )}
                              </div>
                              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  {/* View all link */}
                  <div className="border-t border-border/50 px-4 py-2">
                    <button
                      onClick={() => {
                        navigate(`/search?q=${encodeURIComponent(query.trim())}`);
                        setOpen(false);
                        setQuery('');
                      }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      View all results for "{query}"
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Search history ── */}
          {showHistory && (
            <>
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Recent Searches
                </span>
                <button
                  onClick={clearHistory}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear all
                </button>
              </div>
              {history.slice(0, 8).map((entry) => (
                <div key={entry.query + entry.timestamp} className="flex items-center group">
                  <button
                    onClick={() => handleHistorySelect(entry)}
                    className="flex-1 flex items-center gap-3 px-4 py-2.5 text-left hover:bg-accent transition-colors"
                  >
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono truncate">{truncate(entry.query)}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {entry.type} ·{' '}
                        {formatDistanceToNow(entry.timestamp, { addSuffix: true })}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => removeEntry(entry.query)}
                    className="pr-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    aria-label="Remove from history"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
