import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionStatus } from '../ConnectionStatus';

// Mock the hook so we control status without real WebSocket
vi.mock('@/hooks/useWebSocketStatus', () => ({
  useWebSocketStatus: vi.fn(),
}));

import { useWebSocketStatus } from '@/hooks/useWebSocketStatus';

const mockHook = vi.mocked(useWebSocketStatus);

describe('ConnectionStatus', () => {
  beforeEach(() => {
    mockHook.mockReset();
  });

  it('shows live status', () => {
    mockHook.mockReturnValue({ status: 'connected', label: 'Live', isLive: true, isError: false, isPending: false });
    render(<ConnectionStatus />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('shows error status', () => {
    mockHook.mockReturnValue({ status: 'error', label: 'Connection error', isLive: false, isError: true, isPending: false });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connection error')).toBeInTheDocument();
  });

  it('shows pending/connecting status', () => {
    mockHook.mockReturnValue({ status: 'connecting', label: 'Connecting…', isLive: false, isError: false, isPending: true });
    render(<ConnectionStatus />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('has role=status for accessibility', () => {
    mockHook.mockReturnValue({ status: 'connected', label: 'Live', isLive: true, isError: false, isPending: false });
    render(<ConnectionStatus />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
