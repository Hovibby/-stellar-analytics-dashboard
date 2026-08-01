/**
 * TopAccountsWidget (issue #247)
 *
 * Surfaces the most active accounts by 24h transaction count on the home
 * dashboard.
 */
import { useQuery } from '@apollo/client';
import { useTranslation } from 'react-i18next';
import { TOP_ACCOUNTS_QUERY } from '../graphql/queries';

interface TopAccount {
  accountId: string;
  balanceNative: string;
  transactionCount24h: number;
  isActive: boolean;
}

function truncateAccount(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function TopAccountsWidget() {
  const { t, i18n } = useTranslation();
  const { data, loading, error } = useQuery(TOP_ACCOUNTS_QUERY, {
    variables: { limit: 5 },
    pollInterval: 60_000,
    errorPolicy: 'all',
  });

  const accounts: TopAccount[] = data?.topAccounts ?? [];

  return (
    <section className="card" aria-label={t('widgets.topAccounts')}>
      <h3
        style={{
          margin: '0 0 4px',
          fontSize: '12px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-text-secondary)',
        }}
      >
        {t('widgets.topAccounts')}
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        {t('widgets.byActivity24h')}
      </p>

      {loading && accounts.length === 0 && (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ height: '32px', background: 'var(--color-skeleton-start)', borderRadius: '6px' }}
            />
          ))}
        </div>
      )}

      {error && accounts.length === 0 && (
        <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--color-error)' }}>
          {error.message}
        </p>
      )}

      {!loading && !error && accounts.length === 0 && (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
          {t('widgets.noData')}
        </p>
      )}

      {accounts.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {accounts.map((a, i) => (
            <li
              key={a.accountId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', width: '16px' }}>
                  {i + 1}
                </span>
                <span
                  title={a.accountId}
                  style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'monospace' }}
                >
                  {truncateAccount(a.accountId)}
                </span>
                <span
                  style={{
                    fontSize: '10px',
                    padding: '1px 6px',
                    borderRadius: '999px',
                    background: a.isActive ? 'var(--color-primary)' : 'var(--color-input-disabled)',
                    color: a.isActive ? '#fff' : 'var(--color-text-tertiary)',
                  }}
                >
                  {a.isActive ? t('widgets.active') : t('widgets.inactive')}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {a.transactionCount24h.toLocaleString(i18n.language)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  {t('widgets.txCount24h')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
