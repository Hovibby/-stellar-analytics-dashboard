// Issue #350: Network overview card for total daily payment volume
import React, { useEffect, useState } from 'react';

export interface NetworkOverviewCardProps {
  /** Current daily payment volume in XLM */
  dailyVolume: number | null;
  /** Previous period volume for comparison */
  previousVolume: number | null;
  /** Loading state */
  isLoading?: boolean;
}

export const NetworkOverviewCard: React.FC<NetworkOverviewCardProps> = ({
  dailyVolume,
  previousVolume,
  isLoading,
}) => {
  const [trend, setTrend] = useState<number | null>(null);

  useEffect(() => {
    if (dailyVolume != null && previousVolume != null && previousVolume > 0) {
      setTrend(((dailyVolume - previousVolume) / previousVolume) * 100);
    } else {
      setTrend(null);
    }
  }, [dailyVolume, previousVolume]);

  const formatVolume = (vol: number | null) => {
    if (vol == null) return '—';
    if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(2)}M XLM`;
    if (vol >= 1_000) return `${(vol / 1_000).toFixed(2)}K XLM`;
    return `${vol.toFixed(2)} XLM`;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Daily Payment Volume</h3>
        <span className="text-xs text-gray-400">Network Overview</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/2 mb-2" />
          <div className="h-4 bg-gray-200 rounded w-1/3" />
        </div>
      ) : (
        <>
          <div className="text-3xl font-bold text-gray-900 mb-2">
            {formatVolume(dailyVolume)}
          </div>
          {trend != null && (
            <div className="flex items-center gap-1 text-sm">
              <span className={trend >= 0 ? 'text-green-600' : 'text-red-600'}>
                {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
              </span>
              <span className="text-gray-400">vs previous period</span>
            </div>
          )}
        </>
      )}
    </div>
  );
};
