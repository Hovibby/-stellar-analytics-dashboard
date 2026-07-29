/**
 * IngestionProgressTracker – comprehensive progress tracking for long-running backfills.
 *
 * Provides:
 *  - Moving-average ingestion rate (ledgers/sec) with configurable window
 *  - Estimated completion time (absolute timestamp, not just seconds-remaining)
 *  - Progress history with timestamps for trend analysis
 *  - Integration with Prometheus backfill progress gauge
 *  - Snapshot queries for HTTP endpoint integration
 */
import { metrics } from '../metrics/IndexerMetrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressSnapshot {
  /** Total ledgers in the backfill range */
  total: number;
  /** Ledgers successfully processed */
  processed: number;
  /** Ledgers skipped (already in DB) */
  skipped: number;
  /** Ledgers that failed */
  failed: number;
  /** Percentage complete (0-100) */
  percent: number;
  /** Current ingestion rate in ledgers/sec (moving average) */
  ratePerSecond: number;
  /** Estimated seconds remaining */
  etaSeconds: number;
  /** Estimated completion time (ISO string) */
  etaAbsolute: string | null;
  /** Number of samples used for moving average */
  sampleCount: number;
  /** Timestamp of this snapshot */
  timestamp: string;
}

export interface ProgressHistoryEntry {
  timestamp: string;
  processed: number;
  percent: number;
  ratePerSecond: number;
  etaSeconds: number;
}

export interface ProgressTrackerOptions {
  /** Size of the moving-average window (number of samples). Default 20. */
  windowSize?: number;
  /** Minimum interval between samples in ms. Default 1000. */
  minSampleIntervalMs?: number;
}

export interface TrackProgressUpdate {
  processed: number;
  skipped: number;
  failed: number;
  total: number;
}

// ---------------------------------------------------------------------------
// IngestionProgressTracker
// ---------------------------------------------------------------------------

export class IngestionProgressTracker {
  private readonly windowSize: number;
  private readonly minSampleIntervalMs: number;

  /** Rate samples for moving average */
  private readonly rateSamples: number[] = [];
  private lastSampleTime: number = 0;

  /** Progress history */
  private readonly history: ProgressHistoryEntry[] = [];

  /** Current state */
  private totalLedgers: number = 0;
  private processedCount: number = 0;
  private skippedCount: number = 0;
  private failedCount: number = 0;
  private startedAt: number = 0;

  constructor(options: ProgressTrackerOptions = {}) {
    this.windowSize = options.windowSize ?? 20;
    this.minSampleIntervalMs = options.minSampleIntervalMs ?? 1000;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start tracking a new backfill job.
   */
  startTracking(totalLedgers: number): void {
    this.totalLedgers = totalLedgers;
    this.processedCount = 0;
    this.skippedCount = 0;
    this.failedCount = 0;
    this.startedAt = Date.now();
    this.rateSamples.length = 0;
    this.history.length = 0;
    this.lastSampleTime = 0;

    metrics.setBackfillProgress(0, totalLedgers);
  }

  /**
   * Update progress with the latest counts.
   * Records a rate sample if enough time has elapsed since the last sample.
   */
  updateProgress(update: TrackProgressUpdate): ProgressSnapshot {
    this.processedCount = update.processed;
    this.skippedCount = update.skipped;
    this.failedCount = update.failed;
    this.totalLedgers = update.total;

    const now = Date.now();
    const elapsed = now - this.startedAt;
    const done = this.processedCount + this.skippedCount + this.failedCount;
    const remaining = this.totalLedgers - done;

    // Compute instant rate
    if (elapsed > 0 && done > 0) {
      const instantRate = done / (elapsed / 1000);

      // Sample rate if enough time has passed
      if (now - this.lastSampleTime >= this.minSampleIntervalMs) {
        this.rateSamples.push(instantRate);
        if (this.rateSamples.length > this.windowSize) {
          this.rateSamples.shift();
        }
        this.lastSampleTime = now;
      }
    }

    // Moving average rate
    const avgRate = this.getAverageRate();

    // ETA calculations
    const percent = this.totalLedgers > 0
      ? Math.min(100, Math.round((done / this.totalLedgers) * 100))
      : 0;

    const etaSeconds = avgRate > 0
      ? Math.round(remaining / avgRate)
      : 0;

    const etaAbsolute = etaSeconds > 0
      ? new Date(now + etaSeconds * 1000).toISOString()
      : null;

    // Build snapshot
    const snapshot: ProgressSnapshot = {
      total: this.totalLedgers,
      processed: this.processedCount,
      skipped: this.skippedCount,
      failed: this.failedCount,
      percent,
      ratePerSecond: Math.round(avgRate * 100) / 100,
      etaSeconds,
      etaAbsolute,
      sampleCount: this.rateSamples.length,
      timestamp: new Date().toISOString(),
    };

    // Record history entry (throttled)
    this.recordHistoryEntry(snapshot);

    // Update Prometheus gauge
    metrics.setBackfillProgress(done, this.totalLedgers);

    return snapshot;
  }

  /**
   * Mark the backfill as complete and return a final summary.
   */
  finishTracking(): ProgressSnapshot {
    const final = this.updateProgress({
      processed: this.processedCount,
      skipped: this.skippedCount,
      failed: this.failedCount,
      total: this.totalLedgers,
    });
    return final;
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Get the current progress snapshot without recording a new sample.
   */
  getSnapshot(): ProgressSnapshot {
    const now = Date.now();
    const elapsed = now - this.startedAt;
    const done = this.processedCount + this.skippedCount + this.failedCount;
    const remaining = this.totalLedgers - done;
    const avgRate = this.getAverageRate();
    const percent = this.totalLedgers > 0
      ? Math.min(100, Math.round((done / this.totalLedgers) * 100))
      : 0;
    const etaSeconds = avgRate > 0
      ? Math.round(remaining / avgRate)
      : 0;

    return {
      total: this.totalLedgers,
      processed: this.processedCount,
      skipped: this.skippedCount,
      failed: this.failedCount,
      percent,
      ratePerSecond: Math.round(avgRate * 100) / 100,
      etaSeconds,
      etaAbsolute: etaSeconds > 0
        ? new Date(now + etaSeconds * 1000).toISOString()
        : null,
      sampleCount: this.rateSamples.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the progress history for trend analysis.
   */
  getHistory(): ProgressHistoryEntry[] {
    return [...this.history];
  }

  /**
   * Get the elapsed time in milliseconds since tracking started.
   */
  getElapsedMs(): number {
    return this.startedAt > 0 ? Date.now() - this.startedAt : 0;
  }

  /**
   * Check if tracking is active.
   */
  isActive(): boolean {
    return this.startedAt > 0;
  }

  /**
   * Reset all tracking state.
   */
  reset(): void {
    this.totalLedgers = 0;
    this.processedCount = 0;
    this.skippedCount = 0;
    this.failedCount = 0;
    this.startedAt = 0;
    this.rateSamples.length = 0;
    this.history.length = 0;
    this.lastSampleTime = 0;
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  getProcessed(): number { return this.processedCount; }
  getSkipped(): number { return this.skippedCount; }
  getFailed(): number { return this.failedCount; }
  getTotal(): number { return this.totalLedgers; }
  getStartedAt(): number { return this.startedAt; }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Compute the moving-average ingestion rate.
   * Returns 0 if insufficient data.
   */
  private getAverageRate(): number {
    if (this.rateSamples.length === 0) {
      return 0;
    }
    const sum = this.rateSamples.reduce((a, b) => a + b, 0);
    return sum / this.rateSamples.length;
  }

  /**
   * Record a history entry (throttled to one per ~30s for reasonable history size).
   */
  private recordHistoryEntry(snapshot: ProgressSnapshot): void {
    const lastEntry = this.history[this.history.length - 1];
    if (lastEntry) {
      const lastTime = new Date(lastEntry.timestamp).getTime();
      if (Date.now() - lastTime < 30_000) {
        return; // Throttle to ~30s intervals
      }
    }

    this.history.push({
      timestamp: snapshot.timestamp,
      processed: snapshot.processed,
      percent: snapshot.percent,
      ratePerSecond: snapshot.ratePerSecond,
      etaSeconds: snapshot.etaSeconds,
    });

    // Keep last 100 entries to avoid unbounded memory
    if (this.history.length > 100) {
      this.history.shift();
    }
  }
}
