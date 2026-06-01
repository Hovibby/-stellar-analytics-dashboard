import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock URL.createObjectURL / revokeObjectURL
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = vi.fn();

// Suppress console.warn for known noisy warnings in tests
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0]);
    if (
      msg.includes('[GraphQL error]') ||
      msg.includes('[Network error]') ||
      msg.includes('ReactDOM.render')
    ) {
      return;
    }
    originalWarn(...args);
  };
});

afterEach(() => {
  console.warn = originalWarn;
});
