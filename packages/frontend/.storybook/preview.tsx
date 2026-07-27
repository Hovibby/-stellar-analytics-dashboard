import type { Preview } from '@storybook/react';
import React from 'react';
import '../src/index.css';

/**
 * Global Storybook preview configuration.
 *
 * - Injects Tailwind base styles so CSS custom properties resolve in all stories.
 * - Adds a light/dark theme toggle via the `theme` global parameter, mirroring
 *   the app's `data-theme` attribute behaviour.
 */

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Global theme (light or dark)',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', icon: 'sun', title: 'Light' },
          { value: 'dark', icon: 'moon', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme ?? 'light';
      // Apply theme attribute to <html> so CSS vars in index.css are picked up
      document.documentElement.setAttribute('data-theme', theme);
      document.documentElement.className = theme === 'dark' ? 'dark' : '';

      return (
        <div className="min-h-screen bg-background p-6">
          <Story />
        </div>
      );
    },
  ],
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /date$/i,
      },
    },
    backgrounds: {
      disable: true, // We control backgrounds via the theme global above
    },
    layout: 'padded',
  },
};

export default preview;
