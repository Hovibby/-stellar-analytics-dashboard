/**
 * NetworkChart
 *
 * Multi-metric area chart for network activity.
 * Supports toggling between transaction count, operation count,
 * active accounts, and average fee. Includes export.
 */
import { useState, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts';
import { format } from 'date-fns';
import { Download, ImageIcon, RefreshCcw } from 'lucide-react';
import { clsx } from 'clsx';
import { NETWORK_METRICS_QUERY } from '@/graphql/queries';
import { ChartTooltip } from './ChartTooltip';
import { ChartLegend } from './ChartLegend';

type ActiveSeries = 'transactionCount' | 'operationCount' | 'activeAccounts' | 'averageFee';

const SERIES: { key: ActiveSeries; label: string; color: string; unit?: string }[] = [
  { key: 'transactionCount', label: 'Transactions', color: 'hsl(var(--primary))' },
  { key: 'operationCount', label: 'Operations', color: '#10b981' },
  { key: 'activeAccounts', label: 'Active Accounts', color: '#f59e0b' },
  { key: 'averageFee', label: 'Avg Fee', color: '#8b5cf6', unit: 'str' },
];

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <ChartTooltip
      header={format(new Date(d.timestamp), 'MMM dd HH:mm')}
      minWidth={170}
      rows={SERIES.map((s) => ({
        label: s.label,
        value: `${typeof d[s.key] === 'number' ? d[s.key].toLocaleString() : '—'}${s.unit ? ` ${s.unit}` : ''}`,
        color: s.color,
        dot: true,
      }))}
    />
  );
}

function exportCSV(data: any[]) {
  const headers = ['timestamp', 'transactionCount', 'operationCount', 'activeAccounts', 'averageFee', 'successRate', 'totalVolume'];
  const rows = data.map((d) => headers.map((h) => d[h] ?? ''));
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `network-activity-${format(new Date(), 'yyyy-MM-dd')}.csv`;
  link.click();
}

function exportPNG(ref: React.RefObject<HTMLDivElement>) {
  const svg = ref.current?.querySelector('svg');
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
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0);
    const link = document.createElement('a');
    link.download = `network-activity-${format(new Date(), 'yyyy-MM-dd')}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}`;
}

export function NetworkChart() {
  const [activeSeries, setActiveSeries] = useState<ActiveSeries>('transactionCount');
  const chartRef = useRef<HTMLDivElement>(null);

  const { data, loading, refetch } = useQuery(NETWORK_METRICS_QUERY, {
    variables: { timeRange: { last: '24h' } },
    pollInterval: 10_000,
    notifyOnNetworkStatusChange: true,
  });

  const chartData = useMemo(() => {
    const raw: any[] = data?.networkMetrics ?? [];
    if (!raw.length) return [];
    return raw.map((m) => ({
      timestamp: m.timestamp,
      transactionCount: m.transactionCount ?? 0,
      operationCount: m.operationCount ?? 0,
      activeAccounts: m.activeAccounts ?? 0,
      averageFee: m.averageFee ?? 0,
      successRate: m.successRate ?? 0,
      totalVolume: parseFloat(m.totalVolume ?? '0'),
    }));
  }, [data]);

  const series = SERIES.find((s) => s.key === activeSeries)!;

  const handleExportCSV = useCallback(() => exportCSV(chartData), [chartData]);
  const handleExportPNG = useCallback(() => exportPNG(chartRef), []);

  if (loading && !chartData.length) {
    return <div className="h-80 bg-muted/30 animate-pulse rounded-xl" />;
  }

  return (
    <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
            Network Activity (24h)
          </h3>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => refetch()}
            disabled={loading}
            className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCcw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            onClick={handleExportPNG}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            PNG
          </button>
        </div>
      </div>

      {/* Series selector */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {SERIES.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSeries(s.key)}
            style={activeSeries === s.key ? { borderColor: s.color, color: s.color, backgroundColor: `${s.color}18` } : {}}
            className={clsx(
              'px-3 py-1 rounded-full text-xs font-medium border transition-all',
              activeSeries === s.key
                ? 'border-current'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div ref={chartRef} className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="networkGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={series.color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={series.color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
            <XAxis
              dataKey="timestamp"
              tickFormatter={(ts) => format(new Date(ts), 'HH:mm')}
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) =>
                v >= 1_000_000
                  ? `${(v / 1_000_000).toFixed(1)}M`
                  : v >= 1_000
                    ? `${(v / 1_000).toFixed(0)}K`
                    : String(v)
              }
              width={44}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={activeSeries}
              stroke={series.color}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#networkGradient)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0, fill: series.color }}
            />
          </AreaChart>
          <ChartLegend items={SERIES.map((s) => ({ label: s.label, color: s.color }))} className="pt-3" />
        </ResponsiveContainer>
      </div>
    </div>
  );
}
