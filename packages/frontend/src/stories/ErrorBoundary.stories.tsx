import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * ErrorBoundary — catches render errors in its subtree and shows a fallback UI.
 *
 * Use the `ThrowOnRender` helper child below to trigger the error state in
 * Storybook without needing a real failing component in the codebase.
 */

/** Helper that throws immediately on render — only used inside stories. */
function ThrowOnRender({ message }: { message: string }): never {
  throw new Error(message);
}

const meta = {
  title: 'Components/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NormalChildren: Story = {
  name: 'Passes through healthy children',
  args: {
    children: (
      <div className="p-4 rounded-lg border text-sm text-muted-foreground">
        ✅ No error — children render normally.
      </div>
    ),
  },
};

export const ErrorState: Story = {
  name: 'Catches a render error',
  args: {
    children: <ThrowOnRender message="Simulated component crash" />,
  },
  parameters: {
    // Suppress Storybook's own error overlay so the fallback UI is visible
    chromatic: { disableSnapshot: false },
  },
};

export const CustomFallback: Story = {
  name: 'Custom fallback prop',
  args: {
    fallback: (
      <div className="rounded-lg border border-destructive p-6 text-center text-destructive text-sm">
        Custom fallback — this was passed via the <code>fallback</code> prop.
      </div>
    ),
    children: <ThrowOnRender message="Simulated component crash" />,
  },
};
