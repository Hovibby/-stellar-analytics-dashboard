import { type ReactNode } from 'react';
import { clsx } from 'clsx';

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  dot?: boolean;
}

interface ChartTooltipProps {
  header?: ReactNode;
  rows: TooltipRow[];
  className?: string;
  minWidth?: number;
  children?: ReactNode;
}

export function ChartTooltip({ header, rows, className, minWidth = 160, children }: ChartTooltipProps) {
  return (
    <div
      className={clsx(
        'bg-card border border-border rounded-xl shadow-xl p-3 text-xs animate-in fade-in slide-in-from-top-1 duration-200',
        className
      )}
      style={{ minWidth }}
    >
      {header && (
        <div className="font-semibold text-foreground mb-2 border-b border-border pb-1.5">
          {header}
        </div>
      )}
      <div className="space-y-1">
        {rows.map((row, i) => (
          <div key={i} className="flex justify-between gap-4 items-center">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {row.dot && (
                <span
                  className="inline-block rounded-full shrink-0"
                  style={{ width: 6, height: 6, backgroundColor: row.color || 'hsl(var(--foreground))' }}
                />
              )}
              {row.label}
            </span>
            <span className="font-mono font-semibold tabular-nums" style={{ color: row.color }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
      {children}
    </div>
  );
}
