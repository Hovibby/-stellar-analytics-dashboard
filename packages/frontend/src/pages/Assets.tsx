import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@apollo/client';
import { ASSET_METRICS_QUERY } from '@/graphql/queries';
import { DataTable } from '@/components/DataTable';
import { FilterBar, FilterRow, ToggleGroup, RangeInput } from '@/components/FilterBar';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, type TooltipProps } from 'recharts';
import { ChartTooltip } from '@/components/ChartTooltip';
import { Coins, ArrowRightLeft, DollarSign, RefreshCcw, Search } from 'lucide-react';
import { MetricCard } from '@/components/MetricCard';
import { useFilterSort } from '@/hooks/useFilterSort';
import type { FilterPreset } from '@/components/FilterBar';
import { assetFiltersSchema } from '@/lib/validation';
import { clsx } from 'clsx';

// ── filter defaults ───────────────────────────────────────────────────────────

const DEFAULTS = {
  search: '',
  assetType: '' as '' | 'native' | 'credit_alphanum4' | 'credit_alphanum12',
  minVolume: '',
  maxVolume: '',
  minHolders: '',
};

type AssetFilters = typeof DEFAULTS;

function buildGqlFilter(filters: AssetFilters) {
  const f: Record<string, unknown> = {};
  if (filters.assetType) f.assetType = filters.assetType;
  return Object.keys(f).length ? f : undefined;
}

function clientSort(assets: any[], field: string, dir: 'asc' | 'desc') {
  return [...assets].sort((a, b) => {
    let av: number | string = 0;
    let bv: number | string = 0;
    switch (field) {
      case 'volume24h':
        av = parseFloat(a.volume24h ?? '0'); bv = parseFloat(b.volume24h ?? '0'); break;
      case 'trades24h':
        av = a.trades24h ?? 0; bv = b.trades24h ?? 0; break;
      case 'holders':
        av = a.holders ?? 0; bv = b.holders ?? 0; break;
      case 'priceChange24h':
        av = parseFloat(a.priceChange24h ?? '0'); bv = parseFloat(b.priceChange24h ?? '0'); break;
      case 'assetCode':
        av = a.asset.native ? 'XLM' : (a.asset.assetCode ?? '');
        bv = b.asset.native ? 'XLM' : (b.asset.assetCode ?? '');
        break;
      default:
        return 0;
    }
    return dir === 'asc' ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
  });
}

// ── component ─────────────────────────────────────────────────────────────────

export function Assets() {
  const [filterErrors, setFilterErrors] = useState<Record<string, string>>({});
  const { filters, sort, setFilter, setSort, resetFilters, activeCount } =
    useFilterSort<AssetFilters>({
      defaults: DEFAULTS,
      sortDefaults: { field: 'volume24h', dir: 'desc' },
    });

  const { data, loading, refetch } = useQuery(ASSET_METRICS_QUERY, {
    variables: {
      first: 50,
      filter: buildGqlFilter(filters),
      timeRange: { last: '24h' },
    },
    pollInterval: 30000,
    notifyOnNetworkStatusChange: true,
  });

  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (JSON.stringify(prevFiltersRef.current) !== JSON.stringify(filters)) {
      prevFiltersRef.current = filters;
      refetch({ first: 50, filter: buildGqlFilter(filters) });
    }
  }, [filters, refetch]);

  const rawAssets = data?.assetMetrics || [];

  // Client-side filters
  const clientFiltered = rawAssets.filter((m: any) => {
    const code = m.asset.native ? 'XLM' : (m.asset.assetCode ?? '');
    if (filters.search && !code.toLowerCase().includes(filters.search.toLowerCase())) return false;
    if (filters.minVolume && parseFloat(m.volume24h ?? '0') < parseFloat(filters.minVolume)) return false;
    if (filters.maxVolume && parseFloat(m.volume24h ?? '0') > parseFloat(filters.maxVolume)) return false;
    if (filters.minHolders && (m.holders ?? 0) < parseInt(filters.minHolders)) return false;
    return true;
  });

  const sorted = clientSort(clientFiltered, sort.field, sort.dir);

  const totalVolume = sorted.reduce((acc: number, m: any) => acc + parseFloat(m.volume24h ?? '0'), 0);
  const totalTrades = sorted.reduce((acc: number, m: any) => acc + (m.trades24h ?? 0), 0);

  const chartData = sorted.slice(0, 10).map((m: any) => ({
    name: m.asset.native ? 'XLM' : m.asset.assetCode,
    volume: parseFloat(m.volume24h ?? '0'),
  }));

  function VolumeTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload as { name: string; volume: number } | undefined;
    if (!d) return null;
    return (
      <ChartTooltip
        header={<span>{d.name}</span>}
        rows={[{ label: '24h Volume', value: `${d.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })} XLM`, color: 'hsl(var(--primary))', dot: true }]}
      />
    );
  }

  // ── presets ────────────────────────────────────────────────────────────────

  const validateFilters = (updated: AssetFilters) => {
    const result = assetFiltersSchema.safeParse(updated);
    if (!result.success) {
      const errs: Record<string, string> = {};
      result.error.errors.forEach((e) => {
        const key = e.path[0] as string;
        errs[key] = e.message;
      });
      setFilterErrors(errs);
    } else {
      setFilterErrors({});
    }
  };

  const presets: FilterPreset[] = [
    {
      label: 'Native only',
      apply: () => { resetFilters(); setFilter('assetType', 'native'); },
    },
    {
      label: 'Custom assets',
      apply: () => { resetFilters(); setFilter('assetType', 'credit_alphanum4'); },
    },
    {
      label: 'High volume (>1M)',
      apply: () => { resetFilters(); setFilter('minVolume', '1000000'); },
    },
    {
      label: 'Many holders (>1k)',
      apply: () => { resetFilters(); setFilter('minHolders', '1000'); },
    },
  ];

  // ── columns ────────────────────────────────────────────────────────────────

  const columns = [
    {
      header: 'Asset',
      sortField: 'assetCode',
      accessor: (item: any) => (
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center font-bold text-xs text-primary border border-primary/20 shrink-0">
            {item.asset.native ? 'X' : (item.asset.assetCode?.[0] ?? '?')}
          </div>
          <div>
            <div className="font-bold text-sm">
              {item.asset.native ? 'Stellar Lumens' : item.asset.assetCode}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {item.asset.native
                ? 'Native'
                : item.asset.assetIssuer
                  ? `${item.asset.assetIssuer.slice(0, 6)}…${item.asset.assetIssuer.slice(-4)}`
                  : '—'}
            </div>
          </div>
        </div>
      ),
    },
    {
      header: '24h Volume',
      sortField: 'volume24h',
      accessor: (item: any) => (
        <span className="font-mono text-sm tabular-nums">
          {parseFloat(item.volume24h ?? '0').toLocaleString(undefined, { maximumFractionDigits: 0 })} XLM
        </span>
      ),
    },
    {
      header: 'Trades (24h)',
      sortField: 'trades24h',
      accessor: (item: any) => (
        <span className="font-medium tabular-nums">{(item.trades24h ?? 0).toLocaleString()}</span>
      ),
      className: 'text-center',
    },
    {
      header: 'Holders',
      sortField: 'holders',
      accessor: (item: any) => (
        <span className="tabular-nums">{(item.holders ?? 0).toLocaleString()}</span>
      ),
      className: 'text-center',
    },
    {
      header: 'Price Δ 24h',
      sortField: 'priceChange24h',
      accessor: (item: any) => {
        const change = parseFloat(item.priceChange24h ?? '0');
        return (
          <span className={`text-xs font-bold ${change >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
          </span>
        );
      },
      className: 'text-right',
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DEX Explorer</h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            <p className="text-muted-foreground text-sm font-medium">Live market liquidity</p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-2 px-4 py-2 bg-secondary/50 text-secondary-foreground rounded-lg hover:bg-secondary transition-all border border-border"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} />
          <span className="text-xs font-bold uppercase tracking-wider">Update Markets</span>
        </button>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <MetricCard title="Tracked Assets" value={sorted.length} icon={Coins} />
        <MetricCard
          title="Global 24h Volume"
          value={
            totalVolume > 1_000_000
              ? `${(totalVolume / 1_000_000).toFixed(2)}M`
              : totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })
          }
          icon={DollarSign}
          changeLabel="XLM Total"
        />
        <MetricCard
          title="Network Trades"
          value={totalTrades.toLocaleString()}
          icon={ArrowRightLeft}
          changeLabel="24h activity"
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by asset code…"
          value={filters.search}
          onChange={(e) => setFilter('search', e.target.value)}
          aria-label="Search assets by code"
          className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/30 text-sm"
        />
      </div>

      {/* Filter bar */}
      <FilterBar activeCount={activeCount} onReset={() => { resetFilters(); setFilterErrors({}); }} presets={presets}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          <FilterRow label="Asset type">
            <ToggleGroup
              options={[
                { label: 'Any', value: '' },
                { label: 'Native', value: 'native' },
                { label: 'Alpha4', value: 'credit_alphanum4' },
                { label: 'Alpha12', value: 'credit_alphanum12' },
              ]}
              value={filters.assetType}
              onChange={(v) => setFilter('assetType', v as string)}
            />
          </FilterRow>

          <FilterRow label="24h Volume">
            <RangeInput
              minValue={filters.minVolume}
              maxValue={filters.maxVolume}
              onMinChange={(v) => {
                setFilter('minVolume', v);
                validateFilters({ ...filters, minVolume: v });
              }}
              onMaxChange={(v) => {
                setFilter('maxVolume', v);
                validateFilters({ ...filters, maxVolume: v });
              }}
              placeholder={{ min: '0', max: '∞' }}
              unit="XLM"
              maxError={filterErrors.maxVolume}
            />
          </FilterRow>

          <FilterRow label="Min holders">
            <div className="flex flex-col gap-0.5">
              <input
                type="number"
                min="0"
                value={filters.minHolders}
                onChange={(e) => {
                  setFilter('minHolders', e.target.value);
                  validateFilters({ ...filters, minHolders: e.target.value });
                }}
                placeholder="0"
                aria-label="Minimum number of holders"
                aria-invalid={!!filterErrors.minHolders}
                className={clsx(
                  'w-28 px-3 py-1.5 rounded-lg border bg-background text-sm focus:outline-none focus:ring-2',
                  filterErrors.minHolders
                    ? 'border-destructive focus:ring-destructive/30'
                    : 'border-border focus:ring-primary/30'
                )}
              />
              {filterErrors.minHolders && (
                <span className="text-[10px] text-destructive">{filterErrors.minHolders}</span>
              )}
            </div>
          </FilterRow>
        </div>
      </FilterBar>

      {/* Chart + table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="bg-card p-6 rounded-2xl border border-border shadow-sm lg:col-span-1">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-8">
            Volume Leaders
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: -10, right: 20 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'hsl(var(--foreground))', fontSize: 11, fontWeight: 600 }}
                  width={60}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted)/0.2)' }}
                  content={<VolumeTooltip />}
                />
                <Bar dataKey="volume" radius={[0, 4, 4, 0]} barSize={18}>
                  {chartData.map((_: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        index === 0
                          ? 'hsl(var(--primary))'
                          : `hsl(var(--primary) / ${Math.max(0.3, 1 - index * 0.15)})`
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2">
          <DataTable
            columns={columns}
            data={sorted}
            loading={loading}
            sort={sort}
            onSort={setSort}
            totalCount={sorted.length}
          />
        </div>
      </div>
    </div>
  );
}
