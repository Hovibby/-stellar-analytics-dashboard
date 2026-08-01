/**
 * LayoutCustomizer (issue #231)
 *
 * Lets the user reorder dashboard panels and toggle their visibility;
 * changes are persisted via useDashboardLayout (localStorage).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PanelConfig, PanelId } from '../hooks/useDashboardLayout';

interface LayoutCustomizerProps {
  layout: PanelConfig[];
  toggleVisibility: (id: PanelId) => void;
  move: (id: PanelId, direction: 'up' | 'down') => void;
  reset: () => void;
}

export function LayoutCustomizer({
  layout,
  toggleVisibility,
  move,
  reset,
}: LayoutCustomizerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-haspopup="true"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: '13px',
          color: 'var(--color-text-primary)',
        }}
      >
        {t('layout.customize')}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={t('layout.panels')}
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: '280px',
            background: 'var(--color-bg-primary, #fff)',
            border: '1px solid var(--color-border)',
            borderRadius: '10px',
            padding: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase' }}>
              {t('layout.panels')}
            </span>
            <button
              onClick={() => setIsOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '13px',
                color: 'var(--color-text-secondary)',
              }}
            >
              {t('layout.done')}
            </button>
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {layout.map((panel, index) => (
              <li
                key={panel.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderTop: index > 0 ? '1px solid var(--color-border)' : 'none',
                  opacity: panel.visible ? 1 : 0.5,
                }}
              >
                <span style={{ fontSize: '13px' }}>{t(`layout.panel.${panel.id}`)}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => move(panel.id, 'up')}
                    disabled={index === 0}
                    aria-label={t('layout.moveUp')}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      width: '24px',
                      height: '24px',
                      cursor: index === 0 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(panel.id, 'down')}
                    disabled={index === layout.length - 1}
                    aria-label={t('layout.moveDown')}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      width: '24px',
                      height: '24px',
                      cursor: index === layout.length - 1 ? 'not-allowed' : 'pointer',
                    }}
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => toggleVisibility(panel.id)}
                    aria-label={panel.visible ? t('layout.hidePanel') : t('layout.showPanel')}
                    aria-pressed={panel.visible}
                    style={{
                      background: panel.visible ? 'var(--color-primary)' : 'transparent',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px',
                      width: '24px',
                      height: '24px',
                      cursor: 'pointer',
                      color: panel.visible ? '#fff' : 'var(--color-text-secondary)',
                    }}
                  >
                    {panel.visible ? '●' : '○'}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={reset}
            style={{
              marginTop: '12px',
              width: '100%',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: '6px',
              padding: '6px',
              cursor: 'pointer',
              fontSize: '12px',
              color: 'var(--color-text-secondary)',
            }}
          >
            {t('layout.resetLayout')}
          </button>
        </div>
      )}
    </div>
  );
}
