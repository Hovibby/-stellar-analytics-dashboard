/**
 * Export utility functions for CSV and JSON data export
 * Provides client-side export functionality with progress tracking
 */

export type ExportFormat = 'csv' | 'json' | 'pdf' | 'image';

export interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Convert data to CSV format
 */
function arrayToCSV<T extends Record<string, any>>(data: T[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvRows: string[] = [];

  // Add header row
  csvRows.push(headers.join(','));

  // Add data rows
  for (const row of data) {
    const values = headers.map(header => {
      const value = row[header];
      // Handle null/undefined
      if (value === null || value === undefined) return '';
      // Handle objects/arrays (stringify)
      if (typeof value === 'object') return JSON.stringify(value);
      // Escape quotes and wrap in quotes if contains comma or quote
      const stringValue = String(value);
      if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    });
    csvRows.push(values.join(','));
  }

  return csvRows.join('\n');
}

/**
 * Convert dashboard stats to flat array for export
 */
export function statsToArray(stats: any): Record<string, any>[] {
  return [{
    network: stats.network,
    totalLedgers: stats.totalLedgers,
    totalTransactions: stats.totalTransactions,
    totalOperations: stats.totalOperations,
    totalAccounts: stats.totalAccounts,
    totalAssets: stats.totalAssets,
    activeAccounts24h: stats.activeAccounts24h,
    volume24h: stats.volume24h,
    averageFee24h: stats.averageFee24h,
    successRate24h: stats.successRate24h,
    latestLedger: stats.latestLedger,
    latestLedgerTime: stats.latestLedgerTime,
    exportedAt: new Date().toISOString(),
  }];
}

/**
 * Export data as CSV
 */
export async function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  onProgress?.(10);
  
  const csv = arrayToCSV(data);
  onProgress?.(50);
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  onProgress?.(80);
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  onProgress?.(100);
}

/**
 * Export data as JSON
 */
export async function exportToJSON<T extends Record<string, any>>(
  data: T[],
  filename: string,
  onProgress?: (progress: number) => void
): Promise<void> {
  onProgress?.(10);
  
  const json = JSON.stringify(data, null, 2);
  onProgress?.(50);
  
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  onProgress?.(80);
  
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}.json`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  onProgress?.(100);
}

/**
 * Main export function that handles both CSV and JSON formats
 */
export async function exportData<T extends Record<string, any>>(
  data: T[],
  options: ExportOptions
): Promise<void> {
  const { format, filename = 'export', onProgress } = options;
  
  if (format === 'csv') {
    await exportToCSV(data, filename, onProgress);
  } else if (format === 'json') {
    await exportToJSON(data, filename, onProgress);
  } else {
    throw new Error(`Unsupported export format: ${format}`);
  }
}

/**
 * Generate filename with timestamp
 */
export function generateFilename(baseName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `${baseName}-${timestamp}`;
}

/**
 * Export dashboard stats as a beautiful shareable OG-style card PNG image
 */
export async function exportAsImage(stats: any, isDarkMode: boolean): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Background
  const gradient = ctx.createLinearGradient(0, 0, 1200, 630);
  if (isDarkMode) {
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#1e293b');
  } else {
    gradient.addColorStop(0, '#f8fafc');
    gradient.addColorStop(1, '#e2e8f0');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1200, 630);

  // Title
  ctx.fillStyle = isDarkMode ? '#f1f5f9' : '#0f172a';
  ctx.font = 'bold 36px "Segoe UI", Arial, sans-serif';
  ctx.fillText('STELLAR ANALYTICS DASHBOARD', 60, 80);

  // Subtitle
  ctx.fillStyle = isDarkMode ? '#94a3b8' : '#64748b';
  ctx.font = '18px "Segoe UI", Arial, sans-serif';
  const networkStr = String(stats.network || 'unknown').toUpperCase();
  const timeStr = new Date().toLocaleString();
  ctx.fillText(`NETWORK: ${networkStr}  |  GENERATED: ${timeStr}`, 60, 120);

  // Metric boxes
  const metrics = [
    { label: 'TOTAL LEDGERS', value: Number(stats.totalLedgers ?? 0).toLocaleString() },
    { label: 'TOTAL TRANSACTIONS', value: Number(stats.totalTransactions ?? 0).toLocaleString() },
    { label: 'TOTAL OPERATIONS', value: Number(stats.totalOperations ?? 0).toLocaleString() },
    { label: 'TOTAL ACCOUNTS', value: Number(stats.totalAccounts ?? 0).toLocaleString() },
    { label: 'ACTIVE ACCOUNTS (24H)', value: Number(stats.activeAccounts24h ?? 0).toLocaleString() },
    { label: 'VOLUME (24H)', value: String(stats.volume24h ?? '0') },
    { label: 'AVG FEE (24H)', value: `${Number(stats.averageFee24h ?? 0).toFixed(0)} str` },
    { label: 'SUCCESS RATE (24H)', value: `${Number(stats.successRate24h ?? 0).toFixed(1)}%` },
  ];

  const startX = 60;
  const startY = 170;
  const cardW = 250;
  const cardH = 160;
  const gapX = 26;
  const gapY = 30;

  metrics.forEach((m, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const x = startX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // Box background
    ctx.fillStyle = isDarkMode ? '#1e293b' : '#ffffff';
    ctx.beginPath();
    ctx.roundRect(x, y, cardW, cardH, 12);
    ctx.fill();

    // Box border
    ctx.strokeStyle = isDarkMode ? '#334155' : '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = isDarkMode ? '#94a3b8' : '#64748b';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(m.label, x + 20, y + 40);

    // Value
    ctx.fillStyle = isDarkMode ? '#60a5fa' : '#2563eb';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText(m.value, x + 20, y + 100);
  });

  // Footer branding
  ctx.fillStyle = isDarkMode ? '#475569' : '#94a3b8';
  ctx.font = 'italic 14px "Segoe UI", Arial, sans-serif';
  ctx.fillText('stellar-analytics-dashboard • Real-time Ingestion Service', 60, 580);

  // Download
  const link = document.createElement('a');
  link.download = `stellar-analytics-${stats.network || 'network'}-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
