/**
 * TransactionsChart
 *
 * Multi-series interactive chart showing transaction volume, success/fail
 * breakdown, fee trends, and operation counts over configurable time windows.
 *
 * Features:
 * - Time range tabs (1h / 6h / 24h / 7d / 30d)
 * - Metric toggle (volume / fees / operations / success rate)
 * - Brush / zoom on the timeline
 * - Custom animated tooltip
 * - Export as PNG or CSV
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Brush,
  ResponsiveContainer,
  ReferenceLine,
  type TooltipProps,
} from 'recharts';
import { format, subHours, subDays } from 'date-fns';
import {
  Download,
  ImageIcon,
  RefreshCcw,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart2,
  Activity,
  Zap,
  CheckCircle2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { NETWORK_METRICS_QUERY } from '@/graphql/queries';
import { ChartTooltip } from './ChartTooltip';
import { ChartLegend, type LegendItem } from './ChartLegend';

// ── types ─────────────────────────────────────────────────────────────────────

type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';
type MetricKey = 'transactions' | 'fees' | 'operations' | 'successRate';

interface ChartDataPoint {
  timestamp: string;
  transactionCount: number;
  successfulTx: number;
  failedTx: number;
  operationCount: number;
  averageFee: number;
  successRate: number;
  activeAccounts: number;
  totalVolume: number;
}

// ── constants ─────────────────────────────────────────────────────────────────

const TIME_RANGES: { label: string; value: TimeRange; hours: number }[] = [
  { label: '1H', value: '1h', hours: 1 },
  { label: '6H', value: '6h', hours: 6 },
  { label: '24H', value: '24h', hours: 24 },
  { label: '7D', value: '7d', hours: 168 },
  { label: '30D', value: '30d', hours: 720 },
];

const METRICS: { key: MetricKey; label: string; icon: React.ReactNode; color: string }[] = [
  {
    key: 'transactions',
    label: 'Transactions',
    icon: <BarChart2 className="h-3.5 w-3.5" />,
    color: 'hsl(var(--primary))',
  },
  {
    key: 'operations',
    label: 'Operations',
    icon: <Activity className="h-3.5 w-3.5" />,
    color: '#10b981',
  },
  {
    key: 'fees',
    label: 'Avg Fee',
    icon: <Zap className="h-3.5 w-3.5" />,
    color: '#f59e0b',
  },
  {
    key: 'successRate',
    label: 'Success Rate',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: '#8b5cf6',
  },
];

// ── helpers ───────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string, range: TimeRange): string {
  const d = new Date(ts);
  if (range === '1h' || range === '6h') return format(d, 'HH:mm');
  if (range === '24h') return format(d, 'HH:mm');
  return format(d, 'MMM dd');
}

function formatValue(value: number, metric: MetricKey): string {
  if (metric === 'successRate') return `${value.toFixed(1)}%`;
  if (metric === 'fees') return `${value.toFixed(0)} str`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString();
}

function buildTimeRange(range: TimeRange) {
  const now = new Date();
  const hours = TIME_RANGES.find((r) => r.value === range)?.hours ?? 24;
  return {
    startTime: subHours(now, hours).toISOString(),
    endTime: now.toISOString(),
  };
}

/** Synthesise mock data when the API returns nothing (dev / empty DB) */
function generateMockData(range: TimeRange): ChartDataPoint[] {
  const hours = TIME_RANGES.find((r) => r.value === range)?.hours ?? 24;
  const points = Math.min(hours, 48);
  const now = Date.now();
  const step = (hours * 3_600_000) / points;

  return Array.from({ length: points }, (_, i) => {
    const base = 80 + Math.sin(i / 4) * 30 + Math.random() * 20;
    const successful = Math.round(base * (0.92 + Math.random() * 0.07));
    const failed = Math.round(base - successful);
    return {
      timestamp: new Date(now - (points - i) * step).toISOString(),
      transactionCount: Math.round(base),
      successfulTx: successful,
      failedTx: failed,
      operationCount: Math.round(base * (2 + Math.random())),
      averageFee: Math.round(100 + Math.random() * 400),
      successRate: parseFloat(((successful / base) * 100).toFixed(2)),
      activeAccounts: Math.round(50 + Math.random() * 100),
      totalVolume: Math.round(10_000 + Math.random() * 50_000),
    };
  });
}

// ── custom tooltip ────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, range }: TooltipProps<number, string> & { range: TimeRange }) {
  if (!active || !payload?.length) return null;

  const d = payload[0]?.payload as ChartDataPoint | undefined;
  if (!d) return null;

  const header = format(new Date(d.timestamp), range === '7d' || range === '30d' ? 'MMM dd, yyyy' : 'MMM dd HH:mm');

  return (
    <ChartTooltip
      header={header}
      minWidth={190}
      rows={[
        { label: 'Transactions', value: d.transactionCount.toLocaleString(), color: 'hsl(var(--primary))', dot: true },
        { label: 'Successful', value: d.successfulTx.toLocaleString(), color: '#10b981', dot: true },
        { label: 'Failed', value: d.failedTx.toLocaleString(), color: '#ef4444', dot: true },
        { label: 'Operations', value: d.operationCount.toLocaleString(), dot: true },
        { label: 'Avg Fee', value: `${d.averageFee.toFixed(0)} str`, dot: true },
        { label: 'Success Rate', value: `${d.successRate.toFixed(1)}%`, color: '#8b5cf6', dot: true },
      ]}
    />
  );
}

// ── export helpers ────────────────────────────────────────────────────────────

function exportCSV(data: ChartDataPoint[], range: TimeRange) {
  const headers = ['timestamp', 'transactions', 'successful', 'failed', 'operations', 'avgFee', 'successRate', 'activeAccounts'];
  const rows = data.map((d) => [
    d.timestamp,
    d.transactionCount,
    d.successfulTx,
    d.failedTx,
    d.operationCount,
    d.averageFee.toFixed(2),
    d.successRate.toFixed(2),
    d.activeAccounts,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `transactions-${range}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
}

function exportPNG(containerRef: React.RefObject<HTMLDivElement>) {
  const svg = containerRef.current?.querySelector('svg');
  if (!svg) return;

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svg);
  const canvas = document.createElement('canvas');
  const { width, height } = svg.getBoundingClientRect();
  canvas.width = width * 2;
  canvas.height = height * 2;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);

  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card') || '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    const link = document.createElement('a');
    link.download = `transactions-chart-${format(new Date(), 'yyyy-MM-dd')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}`;
}

// ── main component ────────────────────────────────────────────────────────────

export function TransactionsChart() {
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [activeMetric, setActiveMetric] = useState<MetricKey>('transactions');
  const [showSuccessFail, setShowSuccessFail] = useState(true);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, loading, refetch } = useQuery(NETWORK_METRICS_QUERY, {
    variables: { timeRange: buildTimeRange(timeRange) },
    pollInterval: 30_000,
    notifyOnNetworkStatusChange: true,
  });

  // Map API data → chart points; fall back to mock when empty
  const chartData: ChartDataPoint[] = useMemo(() => {
    const raw: any[] = data?.networkMetrics ?? [];
    if (raw.length === 0) return generateMockData(timeRange);

    return raw.map((m) => ({
      timestamp: m.timestamp,
      transactionCount: m.transactionCount ?? 0,
      successfulTx: Math.round((m.transactionCount ?? 0) * ((m.successRate ?? 100) / 100)),
      failedTx: Math.round((m.transactionCount ?? 0) * (1 - (m.successRate ?? 100) / 100)),
      operationCount: m.operationCount ?? 0,
      averageFee: m.averageFee ?? 0,
      successRate: m.successRate ?? 100,
      activeAccounts: m.activeAccounts ?? 0,
      totalVolume: parseFloat(m.totalVolume ?? '0'),
    }));
  }, [data, timeRange]);

  // Summary stats for the header strip
  const summary = useMemo(() => {
    if (!chartData.length) return null;
    const total = chartData.reduce((s, d) => s + d.transactionCount, 0);
    const avgFee = chartData.reduce((s, d) => s + d.averageFee, 0) / chartData.length;
    const avgSuccess = chartData.reduce((s, d) => s + d.successRate, 0) / chartData.length;
    const first = chartData[0].transactionCount;
    const last = chartData[chartData.length - 1].transactionCount;
    const trend = last - first;
    return { total, avgFee, avgSuccess, trend };
  }, [chartData]);

  const handleExportCSV = useCallback(() => exportCSV(chartData, timeRange), [chartData, timeRange]);
  const handleExportPNG = useCallback(() => exportPNG(chartRef), []);

  // Determine which series to render based on active metric
  const primaryColor = METRICS.find((m) => m.key === activeMetric)?.color ?? 'hsl(var(--primary))';

  const legendItems: LegendItem[] = useMemo(() => {
    const items: LegendItem[] = [];
    if (activeMetric !== 'transactions' || !showSuccessFail) {
      items.push({
        label: METRICS.find((m) => m.key === activeMetric)?.label ?? '',
        color: primaryColor,
        active: !hiddenSeries.has('primary'),
        onClick: () => toggleSeries('primary'),
      });
    }
    items.push(
      { label: 'Successful', color: '#10b981', active: !hiddenSeries.has('successfulTx'), onClick: () => toggleSeries('successfulTx') },
      { label: 'Failed', color: '#ef4444', active: !hiddenSeries.has('failedTx'), onClick: () => toggleSeries('failedTx') },
    );
    if (activeMetric !== 'successRate') {
      items.push({ label: 'Success %', color: '#8b5cf6', active: !hiddenSeries.has('successRate'), onClick: () => toggleSeries('successRate') });
    }
    return items;
  }, [activeMetric, showSuccessFail, hiddenSeries, primaryColor]);

  function toggleSeries(key: string) {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const tickFormatter = useCallback(
    (ts: string) => formatTimestamp(ts, timeRange),
    [timeRange]
  );

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-5 sm:pb-4 border-b border-border/60">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold tracking-tight">Transaction Volume</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Network activity over time
            </p>
          </div>

          {/* Summary strip — scrollable on mobile */}
          {summary && (
            <div className="flex items-center gap-3 sm:gap-4 text-xs overflow-x-auto pb-0.5 sm:pb-0">
              <div className="text-center shrink-0">
                <div className="font-bold tabular-nums text-foreground">
                  {summary.total.toLocaleString()}
                </div>
                <div className="text-muted-foreground">Total txs</div>
              </div>
              <div className="h-6 w-px bg-border shrink-0" />
              <div className="text-center shrink-0">
                <div className="font-bold tabular-nums text-foreground">
                  {summary.avgFee.toFixed(0)} str
                </div>
                <div className="text-muted-foreground">Avg fee</div>
              </div>
              <div className="h-6 w-px bg-border shrink-0" />
              <div className="text-center shrink-0">
                <div className={clsx('font-bold tabular-nums flex items-center gap-0.5', summary.avgSuccess >= 99 ? 'text-green-500' : 'text-yellow-500')}>
                  {summary.avgSuccess.toFixed(1)}%
                </div>
                <div className="text-muted-foreground">Success</div>
              </div>
              <div className="h-6 w-px bg-border shrink-0" />
              <div className="text-center shrink-0">
                <div className={clsx('font-bold tabular-nums flex items-center gap-0.5 justify-center', summary.trend > 0 ? 'text-green-500' : summary.trend < 0 ? 'text-red-500' : 'text-muted-foreground')}>
                  {summary.trend > 0 ? <TrendingUp className="h-3 w-3" /> : summary.trend < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  {Math.abs(summary.trend)}
                </div>
                <div className="text-muted-foreground">Trend</div>
              </div>
            </div>
          )}
        </div>

        {/* Controls row — scrollable on mobile */}
        <div className="flex items-center gap-2 mt-4 overflow-x-auto pb-0.5">
          {/* Time range tabs */}
          <div className="flex items-center gap-0.5 bg-muted/50 p-0.5 rounded-lg border border-border shrink-0">
            {TIME_RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setTimeRange(r.value)}
                aria-pressed={timeRange === r.value}
                aria-label={`Show ${r.label} time range`}
                className={clsx(
                  'px-2.5 py-1.5 rounded-md text-xs font-bold transition-all min-h-[32px]',
                  timeRange === r.value
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Metric toggle */}
          <div className="flex items-center gap-1 shrink-0">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setActiveMetric(m.key)}
                aria-pressed={activeMetric === m.key}
                aria-label={`Show ${m.label} metric`}
                style={activeMetric === m.key ? { borderColor: m.color, color: m.color, backgroundColor: `${m.color}15` } : {}}
                className={clsx(
                  'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all min-h-[32px]',
                  activeMetric === m.key
                    ? 'border-current'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-border/80'
                )}
              >
                {m.icon}
                <span className="hidden sm:inline">{m.label}</span>
              </button>
            ))}
          </div>

          {/* Success/fail overlay toggle */}
          <button
            onClick={() => setShowSuccessFail((v) => !v)}
            aria-pressed={showSuccessFail}
            aria-label="Toggle success/fail breakdown"
            className={clsx(
              'flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-all ml-auto shrink-0 min-h-[32px]',
              showSuccessFail
                ? 'border-green-500/40 text-green-600 bg-green-500/10'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Success/Fail</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center"
            aria-label="Refresh chart data"
          >
            <RefreshCcw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} aria-hidden="true" />
          </button>

          {/* Export */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors min-h-[32px]"
              aria-label="Export chart data as CSV"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={handleExportPNG}
              className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors min-h-[32px]"
              aria-label="Export chart as PNG image"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">PNG</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      <div ref={chartRef} className="px-1 pt-4 pb-2 sm:px-2">
        {loading && chartData.length === 0 ? (
          <div className="h-56 sm:h-72 flex items-center justify-center">
            <div className="h-full w-full bg-muted/20 animate-pulse rounded-xl" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={typeof window !== 'undefined' && window.innerWidth < 640 ? 220 : 300}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="txGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={primaryColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={primaryColor} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="hsl(var(--border))"
                strokeOpacity={0.6}
              />

              <XAxis
                dataKey="timestamp"
                tickFormatter={tickFormatter}
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />

              {/* Left Y axis — primary metric */}
              <YAxis
                yAxisId="left"
                stroke="hsl(var(--muted-foreground))"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => formatValue(v, activeMetric)}
                width={52}
              />

              {/* Right Y axis — success rate (always shown as secondary) */}
              {activeMetric !== 'successRate' && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#8b5cf6"
                  fontSize={10}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  domain={[80, 100]}
                  width={40}
                />
              )}

              <Tooltip content={<CustomTooltip range={timeRange} />} />

              <ChartLegend
                items={legendItems}
                className="pt-3 pb-1"
              />

              {/* ── Primary series based on active metric ── */}
              {activeMetric === 'transactions' && (
                <>
                  {showSuccessFail ? (
                    <>
                      {!hiddenSeries.has('successfulTx') && (
                        <Bar
                          yAxisId="left"
                          dataKey="successfulTx"
                          name="Successful"
                          stackId="tx"
                          fill="#10b981"
                          fillOpacity={0.85}
                          radius={[0, 0, 0, 0]}
                          maxBarSize={20}
                        />
                      )}
                      {!hiddenSeries.has('failedTx') && (
                        <Bar
                          yAxisId="left"
                          dataKey="failedTx"
                          name="Failed"
                          stackId="tx"
                          fill="#ef4444"
                          fillOpacity={0.85}
                          radius={[2, 2, 0, 0]}
                          maxBarSize={20}
                        />
                      )}
                    </>
                  ) : (
                    !hiddenSeries.has('primary') && (
                      <Area
                        yAxisId="left"
                        type="monotone"
                        dataKey="transactionCount"
                        name="Transactions"
                        stroke={primaryColor}
                        strokeWidth={2}
                        fill="url(#txGradient)"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    )
                  )}
                </>
              )}

              {activeMetric === 'operations' && !hiddenSeries.has('primary') && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="operationCount"
                  name="Operations"
                  stroke={primaryColor}
                  strokeWidth={2}
                  fill="url(#txGradient)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              )}

              {activeMetric === 'fees' && !hiddenSeries.has('primary') && (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="averageFee"
                  name="Avg Fee (stroops)"
                  stroke={primaryColor}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              )}

              {activeMetric === 'successRate' && !hiddenSeries.has('primary') && (
                <>
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="successRate"
                    name="Success Rate %"
                    stroke={primaryColor}
                    strokeWidth={2}
                    fill="url(#txGradient)"
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                  <ReferenceLine
                    yAxisId="left"
                    y={99}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                    label={{ value: '99%', fill: '#10b981', fontSize: 10, position: 'right' }}
                  />
                </>
              )}

              {/* Secondary: success rate line overlay (when not in successRate mode) */}
              {activeMetric !== 'successRate' && !hiddenSeries.has('successRate') && (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="successRate"
                  name="Success %"
                  stroke="#8b5cf6"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0 }}
                />
              )}

              {/* Brush for zoom */}
              <Brush
                dataKey="timestamp"
                height={24}
                stroke="hsl(var(--border))"
                fill="hsl(var(--muted))"
                travellerWidth={6}
                tickFormatter={tickFormatter}
                startIndex={Math.max(0, chartData.length - 24)}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Footer: data source note ── */}
      <div className="px-6 py-2 border-t border-border/40 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground/60">
          {data?.networkMetrics?.length
            ? `${data.networkMetrics.length} data points · auto-refreshes every 30s`
            : 'Showing sample data · connect API for live metrics'}
        </span>
        {loading && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
            <RefreshCcw className="h-2.5 w-2.5 animate-spin" />
            Updating…
          </span>
        )}
      </div>
    </div>
  );
}
