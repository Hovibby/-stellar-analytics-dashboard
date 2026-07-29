import { useQuery } from '@apollo/client';
import { useTranslation } from 'react-i18next';
import { SERVICE_STATUS_QUERY } from '../graphql/queries';

export function NetworkStatusIndicator() {
  const { t } = useTranslation();
  const { data, error } = useQuery(SERVICE_STATUS_QUERY, {
    pollInterval: 15000, // Poll service status every 15 seconds
    errorPolicy: 'all',
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'var(--color-success)';
      case 'stalled':
        return 'var(--color-warning)';
      case 'unhealthy':
      default:
        return 'var(--color-error)';
    }
  };

  const getStatusText = (status: string) => {
    if (!status) return t('networkStatus.unhealthy');
    return t(`networkStatus.${status}`);
  };

  const api = error ? 'unhealthy' : data?.serviceStatus?.api || 'healthy';
  const indexer = error ? 'unhealthy' : data?.serviceStatus?.indexer || 'healthy';
  const dataSource = error ? 'unhealthy' : data?.serviceStatus?.dataSource || 'healthy';

  return (
    <div
      className="network-status-indicator"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 16px',
        borderRadius: '20px',
        background: 'var(--color-card-background)',
        border: '1px solid var(--color-card-border)',
        fontSize: '12px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: getStatusColor(api),
            display: 'inline-block',
            boxShadow: `0 0 6px ${getStatusColor(api)}`,
          }}
        />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('networkStatus.api')}: <strong>{getStatusText(api)}</strong>
        </span>
      </div>
      
      <div style={{ width: '1px', height: '12px', background: 'var(--color-card-border)' }} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: getStatusColor(indexer),
            display: 'inline-block',
            boxShadow: `0 0 6px ${getStatusColor(indexer)}`,
          }}
        />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('networkStatus.indexer')}: <strong>{getStatusText(indexer)}</strong>
        </span>
      </div>
      
      <div style={{ width: '1px', height: '12px', background: 'var(--color-card-border)' }} />
      
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: getStatusColor(dataSource),
            display: 'inline-block',
            boxShadow: `0 0 6px ${getStatusColor(dataSource)}`,
          }}
        />
        <span style={{ color: 'var(--color-text-secondary)' }}>
          {t('networkStatus.dataSource')}: <strong>{getStatusText(dataSource)}</strong>
        </span>
      </div>
    </div>
  );
}
