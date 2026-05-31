import '@testing-library/jest-dom';

// jsdom doesn't implement ResizeObserver — stub it for recharts ResponsiveContainer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
