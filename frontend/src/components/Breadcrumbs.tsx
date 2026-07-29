import { useTranslation } from 'react-i18next';

interface BreadcrumbsProps {
  activeTab: 'dashboard' | 'ledgers' | 'transactions';
  onNavigate: (tab: 'dashboard' | 'ledgers' | 'transactions') => void;
  drillDownRange: { startTime: string; endTime: string } | null;
  onClearFilter?: () => void;
}

export function Breadcrumbs({ activeTab, onNavigate, drillDownRange, onClearFilter }: BreadcrumbsProps) {
  const { t } = useTranslation();

  const handleHomeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate('dashboard');
  };

  const handleTabClick = (tab: 'dashboard' | 'ledgers' | 'transactions') => (e: React.MouseEvent) => {
    e.preventDefault();
    onNavigate(tab);
  };

  const formatShortTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return isoString;
    }
  };

  return (
    <nav 
      aria-label="breadcrumb" 
      className="breadcrumbs-nav"
      style={{ 
        marginBottom: '16px', 
        fontSize: '13px',
        background: 'var(--color-card-background)',
        border: '1px solid var(--color-card-border)',
        borderRadius: '8px',
        padding: '8px 16px',
        display: 'inline-block',
      }}
    >
      <ol style={{ display: 'flex', listStyle: 'none', padding: 0, margin: 0, alignItems: 'center', gap: '8px' }}>
        <li>
          <a
            href="#home"
            onClick={handleHomeClick}
            style={{
              color: 'var(--color-primary)',
              textDecoration: 'none',
              fontWeight: activeTab === 'dashboard' ? 600 : 400,
            }}
          >
            {t('breadcrumbs.home')}
          </a>
        </li>
        
        {activeTab !== 'dashboard' && (
          <>
            <span style={{ color: '#9ca3af' }}>/</span>
            <li>
              <a
                href="#dashboard"
                onClick={handleHomeClick}
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                {t('breadcrumbs.dashboard')}
              </a>
            </li>
            <span style={{ color: '#9ca3af' }}>/</span>
            <li>
              <span
                style={{
                  color: drillDownRange ? 'var(--color-primary)' : 'var(--color-text-primary)',
                  fontWeight: !drillDownRange ? 600 : 400,
                  cursor: drillDownRange ? 'pointer' : 'default',
                  textDecoration: drillDownRange ? 'underline' : 'none',
                }}
                onClick={drillDownRange ? handleTabClick('transactions') : undefined}
              >
                {activeTab === 'ledgers' ? t('breadcrumbs.ledgers') : t('breadcrumbs.transactions')}
              </span>
            </li>
          </>
        )}

        {activeTab === 'transactions' && drillDownRange && (
          <>
            <span style={{ color: '#9ca3af' }}>/</span>
            <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                {t('breadcrumbs.filtered')}: {formatShortTime(drillDownRange.startTime)} - {formatShortTime(drillDownRange.endTime)}
              </span>
              {onClearFilter && (
                <button
                  onClick={onClearFilter}
                  title="Clear filter"
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--color-error)',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              )}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
