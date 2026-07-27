/**
 * TopAssetsWidget (issue #247)
 *
 * Surfaces the most-traded assets by 24h volume on the home dashboard.
 */
import { useQuery } from '@apollo/client';
import { useTranslation } from 'react-i18next';
import { TOP_ASSETS_QUERY } from '../graphql/queries';

interface TopAsset {
  asset: {
    assetType: string;
    assetCode: string | null;
    assetIssuer: string | null;
    native: boolean;
  };
  volume24h: string;
  trades24h: number;
  priceChange24h: number;
  holders: number;
}

function assetLabel(asset: TopAsset['asset']): string {
  if (asset.native) return 'XLM';
  return asset.assetCode ?? asset.assetType;
}

export function TopAssetsWidget() {
  const { t, i18n } = useTranslation();
  const { data, loading, error } = useQuery(TOP_ASSETS_QUERY, {
    variables: { limit: 5 },
    pollInterval: 60_000,
    errorPolicy: 'all',
  });

  const assets: TopAsset[] = data?.topAssets ?? [];

  return (
    <section className="card" aria-label={t('widgets.topAssets')}>
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
        {t('widgets.topAssets')}
      </h3>
      <p style={{ margin: '0 0 12px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        {t('widgets.byVolume24h')}
      </p>

      {loading && assets.length === 0 && (
        <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{ height: '32px', background: 'var(--color-skeleton-start)', borderRadius: '6px' }}
            />
          ))}
        </div>
      )}

      {error && assets.length === 0 && (
        <p role="alert" style={{ margin: 0, fontSize: '13px', color: 'var(--color-error)' }}>
          {error.message}
        </p>
      )}

      {!loading && !error && assets.length === 0 && (
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--color-text-tertiary)' }}>
          {t('widgets.noData')}
        </p>
      )}

      {assets.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {assets.map((a, i) => (
            <li
              key={`${a.asset.assetType}-${a.asset.assetCode ?? 'native'}-${a.asset.assetIssuer ?? ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--color-text-tertiary)',
                    width: '16px',
                  }}
                >
                  {i + 1}
                </span>
                <span style={{ fontSize: '13px', fontWeight: 600, minWidth: 0 }}>
                  {assetLabel(a.asset)}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {Number(a.volume24h).toLocaleString(i18n.language)}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  {a.trades24h.toLocaleString(i18n.language)} {t('widgets.trades')}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
