import type { Meta, StoryObj } from '@storybook/react';
import React from 'react';
import { clsx } from 'clsx';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

/**
 * ConnectionStatus — header badge showing WebSocket connection state.
 *
 * The real component calls a hook that opens a graphql-ws socket, which we
 * cannot use in isolation. Instead we render a visually-identical "display"
 * version here so all three states (live / error / pending) can be reviewed
 * without a running server.
 */

type WsStatus = 'connected' | 'disconnected' | 'error' | 'connecting' | 'reconnecting';

interface DisplayProps {
  status: WsStatus;
}

function ConnectionStatusDisplay({ status }: DisplayProps) {
  const label: Record<WsStatus, string> = {
    connecting: 'Connecting…',
    connected: 'Live',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected',
    error: 'Connection error',
  };

  const isLive = status === 'connected';
  const isError = status === 'disconnected' || status === 'error';
  const isPending = status === 'connecting' || status === 'reconnecting';

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`WebSocket: ${label[status]}`}
      className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors duration-500',
        isLive && 'bg-green-500/10 border-green-500/20',
        isError && 'bg-red-500/10 border-red-500/20',
        isPending && 'bg-yellow-500/10 border-yellow-500/20'
      )}
    >
      {isLive && (
        <>
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <Wifi className="h-3 w-3 text-green-500" aria-hidden="true" />
          <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">
            {label[status]}
          </span>
        </>
      )}
      {isError && (
        <>
          <WifiOff className="h-3 w-3 text-red-500" aria-hidden="true" />
          <span className="text-[10px] font-bold text-red-500 uppercase tracking-widest">
            {label[status]}
          </span>
        </>
      )}
      {isPending && (
        <>
          <Loader2 className="h-3 w-3 text-yellow-500 animate-spin" aria-hidden="true" />
          <span className="text-[10px] font-bold text-yellow-500 uppercase tracking-widest">
            {label[status]}
          </span>
        </>
      )}
    </div>
  );
}

const meta = {
  title: 'Components/ConnectionStatus',
  component: ConnectionStatusDisplay,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Visual representation of the WebSocket connection badge. The production component ' +
          'drives state via `useWebSocketStatus`; here we accept a `status` prop directly ' +
          'so all states can be explored without a live server.',
      },
    },
  },
  argTypes: {
    status: {
      control: 'select',
      options: ['connected', 'connecting', 'reconnecting', 'disconnected', 'error'],
    },
  },
} satisfies Meta<typeof ConnectionStatusDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  args: { status: 'connected' },
};

export const Connecting: Story = {
  args: { status: 'connecting' },
};

export const Reconnecting: Story = {
  args: { status: 'reconnecting' },
};

export const Disconnected: Story = {
  args: { status: 'disconnected' },
};

export const ErrorState: Story = {
  name: 'Error',
  args: { status: 'error' },
};
