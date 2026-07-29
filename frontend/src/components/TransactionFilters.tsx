/**
 * Advanced filtering and search controls for TransactionsList (issue #227).
 *
 * Server-side filters (status, fee range, memo) map directly to the
 * existing `TransactionFilterInput` / `TimeRangeInput` GraphQL inputs, which
 * are already implemented in packages/api/src/resolvers/transactions.ts.
 * The free-text search box matches against hash/source account of the
 * currently loaded page (client-side) since the API doesn't index those for
 * substring search.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface TransactionFilterState {
  successful?: boolean;
  minFee?: number;
  maxFee?: number;
  hasMemo?: boolean;
  memoType?: string;
}

export interface TransactionTimeRangeState {
  startTime?: string;
  endTime?: string;
}

export interface TransactionFiltersProps {
  filter: TransactionFilterState;
  timeRange: TransactionTimeRangeState;
  search: string;
  onChange: (
    filter: TransactionFilterState,
    timeRange: TransactionTimeRangeState,
    search: string
  ) => void;
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: '6px',
  border: '1px solid var(--color-border)',
  background: 'var(--color-input-bg)',
  color: 'var(--color-text-primary)',
  fontSize: '13px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '12px',
  color: 'var(--color-text-secondary)',
};

export function TransactionFilters({ filter, timeRange, search, onChange }: TransactionFiltersProps) {
  const { t } = useTranslation();
  const [local, setLocal] = useState({ ...filter, ...timeRange, search });

  const emit = (next: typeof local) => {
    setLocal(next);
    const { search: nextSearch, startTime, endTime, ...nextFilter } = next;
    onChange(nextFilter, { startTime, endTime }, nextSearch);
  };

  const statusValue =
    local.successful === undefined ? 'all' : local.successful ? 'success' : 'failed';

  const reset = () => {
    const cleared = { search: '' } as typeof local;
    emit(cleared);
  };

  const hasActiveFilters =
    local.successful !== undefined ||
    local.minFee !== undefined ||
    local.maxFee !== undefined ||
    local.hasMemo !== undefined ||
    !!local.memoType ||
    !!local.startTime ||
    !!local.endTime ||
    !!local.search;

  return (
    <div className="filter-bar" role="search" aria-label={t('filters.title')}>
      <label style={labelStyle}>
        {t('filters.search')}
        <input
          type="text"
          value={local.search}
          placeholder={t('filters.searchPlaceholder')}
          onChange={(e) => emit({ ...local, search: e.target.value })}
          style={{ ...inputStyle, minWidth: '180px' }}
        />
      </label>

      <label style={labelStyle}>
        {t('filters.status')}
        <select
          value={statusValue}
          onChange={(e) => {
            const v = e.target.value;
            emit({
              ...local,
              successful: v === 'all' ? undefined : v === 'success',
            });
          }}
          style={inputStyle}
        >
          <option value="all">{t('filters.all')}</option>
          <option value="success">{t('transactions.success')}</option>
          <option value="failed">{t('transactions.failed')}</option>
        </select>
      </label>

      <label style={labelStyle}>
        {t('filters.minFee')}
        <input
          type="number"
          min={0}
          value={local.minFee ?? ''}
          onChange={(e) =>
            emit({ ...local, minFee: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          style={{ ...inputStyle, width: '90px' }}
        />
      </label>

      <label style={labelStyle}>
        {t('filters.maxFee')}
        <input
          type="number"
          min={0}
          value={local.maxFee ?? ''}
          onChange={(e) =>
            emit({ ...local, maxFee: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          style={{ ...inputStyle, width: '90px' }}
        />
      </label>

      <label style={labelStyle}>
        {t('filters.memoType')}
        <input
          type="text"
          value={local.memoType ?? ''}
          onChange={(e) => emit({ ...local, memoType: e.target.value || undefined })}
          style={{ ...inputStyle, width: '110px' }}
        />
      </label>

      <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: '6px' }}>
        <input
          type="checkbox"
          checked={local.hasMemo ?? false}
          onChange={(e) => emit({ ...local, hasMemo: e.target.checked ? true : undefined })}
        />
        {t('filters.hasMemo')}
      </label>

      <label style={labelStyle}>
        {t('filters.dateFrom')}
        <input
          type="date"
          value={local.startTime ? local.startTime.slice(0, 10) : ''}
          onChange={(e) =>
            emit({
              ...local,
              startTime: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
          style={inputStyle}
        />
      </label>

      <label style={labelStyle}>
        {t('filters.dateTo')}
        <input
          type="date"
          value={local.endTime ? local.endTime.slice(0, 10) : ''}
          onChange={(e) =>
            emit({
              ...local,
              endTime: e.target.value ? new Date(e.target.value).toISOString() : undefined,
            })
          }
          style={inputStyle}
        />
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={reset}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            alignSelf: 'flex-end',
            background: 'var(--color-card-background)',
          }}
        >
          {t('filters.reset')}
        </button>
      )}
    </div>
  );
}
