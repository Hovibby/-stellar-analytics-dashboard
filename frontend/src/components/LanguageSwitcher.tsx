/**
 * LanguageSwitcher component
 *
 * Provides a dropdown to switch between different languages.
 * Uses i18next to change the language and persists the selection in localStorage.
 */
import { useTranslation } from 'react-i18next';

const LANGUAGES = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
];

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  return (
    <div style={{ position: 'relative' }}>
      <select
        value={i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value)}
        style={{
          padding: '6px 12px',
          borderRadius: '8px',
          border: '1px solid var(--color-border)',
          background: 'var(--color-card-background)',
          color: 'var(--color-text-primary)',
          fontSize: '13px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.flag} {lang.name}
          </option>
        ))}
      </select>
    </div>
  );
}
