// Issue #244: Implement anomaly detection summaries
// Highlights unusual spikes or drops in ledger volume, transaction count, or account activity

export interface AnomalyResult {
  metric: string;
  currentValue: number;
  baseline: number;
  deviationPercent: number;
  direction: 'spike' | 'drop';
  severity: 'low' | 'medium' | 'high';
  detectedAt: string;
}

export interface AnomalySummary {
  anomalies: AnomalyResult[];
  totalAnomalies: number;
  highSeverityCount: number;
  monitoredMetrics: string[];
  windowStart: string;
  windowEnd: string;
}

/**
 * Detect anomalies by comparing current values against a rolling baseline.
 * Uses a simple z-score approach: if the deviation exceeds a threshold,
 * it's flagged as an anomaly.
 */
export class AnomalyDetector {
  private history: Map<string, number[]> = new Map();
  private readonly threshold: number;
  private readonly minSamples: number;

  constructor(threshold = 2.0, minSamples = 10) {
    this.threshold = threshold;
    this.minSamples = minSamples;
  }

  /**
   * Record a metric value for baseline tracking.
   */
  record(metric: string, value: number): void {
    const history = this.history.get(metric) ?? [];
    history.push(value);
    // Keep only last 100 samples for rolling baseline
    if (history.length > 100) history.shift();
    this.history.set(metric, history);
  }

  /**
   * Check a metric value against its baseline for anomalies.
   */
  detect(metric: string, currentValue: number): AnomalyResult | null {
    const history = this.history.get(metric);
    if (!history || history.length < this.minSamples) return null;

    // Calculate baseline (mean of history)
    const baseline = history.reduce((sum, v) => sum + v, 0) / history.length;
    if (baseline === 0) return null;

    // Calculate standard deviation
    const variance = history.reduce((sum, v) => sum + Math.pow(v - baseline, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return null;

    // Z-score
    const zScore = Math.abs(currentValue - baseline) / stdDev;
    if (zScore < this.threshold) return null;

    const deviationPercent = ((currentValue - baseline) / baseline) * 100;
    const direction = currentValue > baseline ? 'spike' : 'drop';

    let severity: 'low' | 'medium' | 'high' = 'low';
    if (zScore > 3.0) severity = 'high';
    else if (zScore > 2.5) severity = 'medium';

    return {
      metric,
      currentValue,
      baseline: Math.round(baseline),
      deviationPercent: Math.round(deviationPercent * 100) / 100,
      direction,
      severity,
      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a summary of all anomalies detected in a time window.
   */
  summarize(metrics: { name: string; value: number }[]): AnomalySummary {
    const anomalies: AnomalyResult[] = [];

    for (const { name, value } of metrics) {
      const result = this.detect(name, value);
      if (result) anomalies.push(result);
      this.record(name, value);
    }

    return {
      anomalies: anomalies.sort((a, b) => b.severity.localeCompare(a.severity)),
      totalAnomalies: anomalies.length,
      highSeverityCount: anomalies.filter(a => a.severity === 'high').length,
      monitoredMetrics: metrics.map(m => m.name),
      windowStart: new Date(Date.now() - 3600_000).toISOString(),
      windowEnd: new Date().toISOString(),
    };
  }
}

export const anomalyDetector = new AnomalyDetector();
