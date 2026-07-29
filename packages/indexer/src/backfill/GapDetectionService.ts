/**
 * GapDetectionService – Robust recovery for missing or partially ingested ledgers.
 *
 * Detects gaps in the ledger sequence by comparing what's stored in the database
 * against the expected contiguous sequence from Horizon. Supports three strategies:
 *
 * 1. **DB-ledger scan** – Query `ledgers` table for gaps between min/max sequences.
 * 2. **Idempotency scan** – Query `idempotency_records` for gaps in processed ledgers.
 * 3. **Horizon comparison** – Compare Horizon's latest ledger against our highest.
 *
 * Each gap range can be fed directly into `backfillLedgers()` to fill the hole.
 */
import { Horizon } from '@stellar/stellar-sdk';
import { StellarService } from '../services/stellar-service';
import { db } from '../database/connection';
import { IdempotencyTracker } from '../idempotency/IdempotencyTracker';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerGap {
  /** Start of the gap (inclusive) */
  startSequence: number;
  /** End of the gap (inclusive) */
  endSequence: number;
  /** Number of missing ledgers in this gap */
  gapSize: number;
  /** How this gap was discovered */
  detectionMethod: 'db_scan' | 'idempotency_scan' | 'horizon_lag' | 'dlq_failed';
}

export interface GapDetectionReport {
  gaps: LedgerGap[];
  totalMissing: number;
  dbLedgerCount: number;
  horizonLatestSequence: number;
  dbMinSequence: number | null;
  dbMaxSequence: number | null;
  scannedAt: string;
}

export interface GapRecoveryResult {
  gapsFound: number;
  totalMissing: number;
  gapsRecovered: number;
  ledgersRecovered: number;
  failures: Array<{ gap: LedgerGap; error: string }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// GapDetector
// ---------------------------------------------------------------------------

export class GapDetector {
  private readonly pool: Pool;
  private readonly stellarService: StellarService;
  private readonly idempotency: IdempotencyTracker;

  constructor(
    pool: Pool,
    stellarService: StellarService,
    idempotency: IdempotencyTracker,
  ) {
    this.pool = pool;
    this.stellarService = stellarService;
    this.idempotency = idempotency;
  }

  // ---------------------------------------------------------------------------
  // Gap detection
  // ---------------------------------------------------------------------------

  /**
   * Detect gaps in the ledger sequence by scanning the `ledgers` table.
   *
   * Strategy: Fetch all ledger sequences from the DB, sort, then walk
   * through looking for jumps > 1 between consecutive entries.
   */
  async detectGapsFromDb(): Promise<LedgerGap[]> {
    const client = await this.pool.connect();
    try {
      // Fetch min and max sequences
      const rangeResult = await client.query<{
        min_seq: string | null;
        max_seq: string | null;
        count: string;
      }>(
        `SELECT
           MIN(sequence) AS min_seq,
           MAX(sequence) AS max_seq,
           COUNT(*)      AS count
         FROM ledgers`,
      );

      const minSeq = rangeResult.rows[0]?.min_seq
        ? Number(rangeResult.rows[0].min_seq)
        : null;
      const maxSeq = rangeResult.rows[0]?.max_seq
        ? Number(rangeResult.rows[0].max_seq)
        : null;
      const count = rangeResult.rows[0]?.count
        ? Number(rangeResult.rows[0].count)
        : 0;

      if (!minSeq || !maxSeq || count === 0) {
        return [];
      }

      // Expected ledgers in range
      const expected = maxSeq - minSeq + 1;

      // If we have all expected ledgers, no gaps
      if (count >= expected) {
        return [];
      }

      // Fetch all sequences sorted to find specific gaps
      const { rows } = await client.query<{ sequence: string }>(
        `SELECT sequence FROM ledgers ORDER BY sequence ASC`,
      );

      const gaps: LedgerGap[] = [];
      let prevSeq = minSeq;

      for (const row of rows) {
        const seq = Number(row.sequence);
        if (seq > prevSeq) {
          const diff = seq - prevSeq;
          if (diff > 1) {
            gaps.push({
              startSequence: prevSeq + 1,
              endSequence: seq - 1,
              gapSize: diff - 1,
              detectionMethod: 'db_scan',
            });
          }
        }
        prevSeq = seq;
      }

      // Check for gap after the last sequence up to maxSeq
      if (prevSeq < maxSeq) {
        gaps.push({
          startSequence: prevSeq + 1,
          endSequence: maxSeq,
          gapSize: maxSeq - prevSeq,
          detectionMethod: 'db_scan',
        });
      }

      return gaps;
    } finally {
      client.release();
    }
  }

  /**
   * Detect gaps by comparing Horizon's latest ledger against our highest.
   *
   * If our `lastProcessedLedger` is significantly behind Horizon, there
   * may be a gap that needs backfilling.
   */
  async detectGapsFromHorizonLag(
    lastProcessedLedger: number,
  ): Promise<LedgerGap[]> {
    const horizonLatest = await this.stellarService.getLatestLedger();
    const horizonSeq = horizonLatest.sequence;

    // Check for straggler gap: if we're more than 20 ledgers behind,
    // there's likely a gap that needs filling
    const gap = horizonSeq - 10 - lastProcessedLedger;
    if (gap <= 1) {
      return [];
    }

    const gaps: LedgerGap[] = [];

    // Gap from where we left off to Horizon
    const startSeq = lastProcessedLedger + 1;
    const endSeq = horizonSeq - 10;

    if (startSeq <= endSeq) {
      // Check if these are actually missing in the DB
      const client = await this.pool.connect();
      try {
        const { rows } = await client.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ledgers
           WHERE sequence >= $1 AND sequence <= $2`,
          [startSeq, endSeq],
        );
        const present = Number(rows[0]?.count ?? 0);
        const expected = endSeq - startSeq + 1;
        const missing = expected - present;

        if (missing > 0) {
          // Find the specific gaps in this range
          const gapRanges = await this.findGapsInRange(startSeq, endSeq);
          gaps.push(...gapRanges);
        }
      } finally {
        client.release();
      }
    }

    return gaps;
  }

  /**
   * Find gaps in the idempotency_records table.
   * This catches ledgers that were skipped during processing but might
   * not appear as gaps in the ledgers table.
   */
  async detectGapsFromIdempotency(): Promise<LedgerGap[]> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{
        min_seq: string | null;
        max_seq: string | null;
        count: string;
      }>(
        `SELECT
           MIN(sequence) AS min_seq,
           MAX(sequence) AS max_seq,
           COUNT(*)      AS count
         FROM idempotency_records`,
      );

      const minSeq = rows[0]?.min_seq ? Number(rows[0].min_seq) : null;
      const maxSeq = rows[0]?.max_seq ? Number(rows[0].max_seq) : null;
      const count = rows[0]?.count ? Number(rows[0].count) : 0;

      if (!minSeq || !maxSeq || count === 0) {
        return [];
      }

      const expected = maxSeq - minSeq + 1;
      if (count >= expected) {
        return [];
      }

      // Fetch sorted sequences to find gaps
      const { rows: seqRows } = await client.query<{ sequence: string }>(
        `SELECT DISTINCT sequence FROM idempotency_records
         WHERE sequence >= $1 AND sequence <= $2
         ORDER BY sequence ASC`,
        [minSeq, maxSeq],
      );

      const gaps: LedgerGap[] = [];
      let prevSeq = minSeq;

      for (const row of seqRows) {
        const seq = Number(row.sequence);
        if (seq > prevSeq + 1) {
          gaps.push({
            startSequence: prevSeq + 1,
            endSequence: seq - 1,
            gapSize: seq - prevSeq - 1,
            detectionMethod: 'idempotency_scan',
          });
        }
        prevSeq = seq;
      }

      if (prevSeq < maxSeq) {
        gaps.push({
          startSequence: prevSeq + 1,
          endSequence: maxSeq,
          gapSize: maxSeq - prevSeq,
          detectionMethod: 'idempotency_scan',
        });
      }

      return gaps;
    } finally {
      client.release();
    }
  }

  /**
   * Run all detection strategies and return a combined report.
   */
  async generateReport(): Promise<GapDetectionReport> {
    const [dbGaps, idempotencyGaps, horizonLatest] = await Promise.all([
      this.detectGapsFromDb(),
      this.detectGapsFromIdempotency(),
      this.stellarService.getLatestLedger().catch(() => ({ sequence: 0 })),
    ]);

    // Check DB range
    const client = await this.pool.connect();
    let dbMinSequence: number | null = null;
    let dbMaxSequence: number | null = null;
    let dbLedgerCount = 0;
    try {
      const { rows } = await client.query<{
        min_seq: string | null;
        max_seq: string | null;
        count: string;
      }>('SELECT MIN(sequence) AS min_seq, MAX(sequence) AS max_seq, COUNT(*) AS count FROM ledgers');
      dbMinSequence = rows[0]?.min_seq ? Number(rows[0].min_seq) : null;
      dbMaxSequence = rows[0]?.max_seq ? Number(rows[0].max_seq) : null;
      dbLedgerCount = Number(rows[0]?.count ?? 0);
    } finally {
      client.release();
    }

    // Merge and deduplicate gaps
    const allGaps = this.mergeGaps([...dbGaps, ...idempotencyGaps]);
    const totalMissing = allGaps.reduce((sum, g) => sum + g.gapSize, 0);

    return {
      gaps: allGaps,
      totalMissing,
      dbLedgerCount,
      horizonLatestSequence: (horizonLatest as any).sequence ?? 0,
      dbMinSequence,
      dbMaxSequence,
      scannedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Recovery
  // ---------------------------------------------------------------------------

  /**
   * Recover missing ledgers by backfilling all detected gaps.
   *
   * @param backfillCallback - Function that processes a range of ledgers.
   *        Must accept (startSequence, endSequence) and return Promise<void>.
   * @param onProgress - Optional callback with recovery progress.
   */
  async recoverMissingLedgers(
    backfillCallback: (startSeq: number, endSeq: number) => Promise<void>,
    onProgress?: (message: string) => void,
  ): Promise<GapRecoveryResult> {
    const startTime = Date.now();
    const report = await this.generateReport();

    const result: GapRecoveryResult = {
      gapsFound: report.gaps.length,
      totalMissing: report.totalMissing,
      gapsRecovered: 0,
      ledgersRecovered: 0,
      failures: [],
      durationMs: 0,
    };

    if (report.gaps.length === 0) {
      result.durationMs = Date.now() - startTime;
      onProgress?.('No gaps detected – all ledgers accounted for.');
      return result;
    }

    onProgress?.(`Found ${report.gaps.length} gap(s) totaling ${report.totalMissing} missing ledgers.`);

    // Sort gaps by start sequence ascending
    const sortedGaps = [...report.gaps].sort(
      (a, b) => a.startSequence - b.startSequence,
    );

    for (const gap of sortedGaps) {
      try {
        onProgress?.(
          `Recovering gap: ledger ${gap.startSequence} → ${gap.endSequence} ` +
            `(${gap.gapSize} ledgers, detected via ${gap.detectionMethod})`,
        );

        await backfillCallback(gap.startSequence, gap.endSequence);

        result.gapsRecovered++;
        result.ledgersRecovered += gap.gapSize;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        result.failures.push({ gap, error: errMsg });
        onProgress?.(`Failed to recover gap ${gap.startSequence}-${gap.endSequence}: ${errMsg}`);
      }
    }

    result.durationMs = Date.now() - startTime;

    onProgress?.(
      `Recovery complete: ${result.gapsRecovered}/${result.gapsFound} gaps recovered, ` +
        `${result.ledgersRecovered} ledgers processed in ${result.durationMs}ms.` +
        (result.failures.length > 0
          ? ` ${result.failures.length} gap(s) failed.`
          : ''),
    );

    return result;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Query the DB for specific gaps in a sequence range.
   */
  private async findGapsInRange(
    startSeq: number,
    endSeq: number,
  ): Promise<LedgerGap[]> {
    const client = await this.pool.connect();
    try {
      const { rows } = await client.query<{ sequence: string }>(
        `SELECT sequence FROM ledgers
         WHERE sequence >= $1 AND sequence <= $2
         ORDER BY sequence ASC`,
        [startSeq, endSeq],
      );

      const gaps: LedgerGap[] = [];
      let prevSeq = startSeq - 1;

      for (const row of rows) {
        const seq = Number(row.sequence);
        if (seq > prevSeq + 1) {
          gaps.push({
            startSequence: prevSeq + 1,
            endSequence: seq - 1,
            gapSize: seq - prevSeq - 1,
            detectionMethod: 'horizon_lag',
          });
        }
        prevSeq = seq;
      }

      if (prevSeq < endSeq) {
        gaps.push({
          startSequence: prevSeq + 1,
          endSequence: endSeq,
          gapSize: endSeq - prevSeq,
          detectionMethod: 'horizon_lag',
        });
      }

      return gaps;
    } finally {
      client.release();
    }
  }

  /**
   * Merge overlapping gaps, preferring the more specific detection method.
   */
  private mergeGaps(gaps: LedgerGap[]): LedgerGap[] {
    if (gaps.length <= 1) return gaps;

    // Sort by start sequence, then by end sequence descending (prefer larger ranges)
    const sorted = [...gaps].sort((a, b) => {
      if (a.startSequence !== b.startSequence) {
        return a.startSequence - b.startSequence;
      }
      return b.endSequence - a.endSequence;
    });

    const merged: LedgerGap[] = [sorted[0]];
    const methodPriority: Record<string, number> = {
      db_scan: 3,
      idempotency_scan: 2,
      horizon_lag: 1,
    };

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const current = sorted[i];

      if (current.startSequence <= last.endSequence + 1) {
        // Overlapping or adjacent – merge
        const bestMethod =
          (methodPriority[last.detectionMethod] ?? 0) >=
          (methodPriority[current.detectionMethod] ?? 0)
            ? last.detectionMethod
            : current.detectionMethod;

      const newEnd = Math.max(last.endSequence, current.endSequence);
        const newStart = Math.min(last.startSequence, current.startSequence);
      merged[merged.length - 1] = {
          startSequence: newStart,
          endSequence: newEnd,
          gapSize: newEnd - newStart + 1,
          detectionMethod: bestMethod,
        };
      } else {
        merged.push(current);
      }
    }

    return merged;
  }
}
