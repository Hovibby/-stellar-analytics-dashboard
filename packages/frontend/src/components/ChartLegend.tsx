import { clsx } from 'clsx';

export interface LegendItem {
  label: string;
  color: string;
  active?: boolean;
  onClick?: () => void;
}

interface ChartLegendProps {
  items: LegendItem[];
  className?: string;
}

export function ChartLegend({ items, className }: ChartLegendProps) {
  if (!items.length) return null;

  return (
    <div
      className={clsx('flex flex-wrap items-center justify-center gap-x-4 gap-y-1', className)}
      style={{ fontSize: 11 }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={item.onClick}
          type="button"
          className={clsx(
            'flex items-center gap-1.5 transition-opacity',
            item.active === false ? 'opacity-40 hover:opacity-60' : 'opacity-90 hover:opacity-100',
            item.onClick ? 'cursor-pointer' : 'cursor-default'
          )}
        >
          <span
            className="inline-block rounded-full shrink-0"
            style={{
              width: 8,
              height: 8,
              backgroundColor: item.color,
            }}
          />
          <span className="text-muted-foreground">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
