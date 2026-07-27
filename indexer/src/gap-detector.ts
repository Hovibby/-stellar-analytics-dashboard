/**
 * Gap detection for the Stellar Analytics Indexer (legacy system).
 *
 * Detects missing ledger sequences in the database and provides a recovery
 * function to backfill them. Integrates with the existing backfill machinery.
 */
import { Pool } from "pg";
import { Horizon } from "@stellar/stellar-sdk";
import { STELLAR_NETWORKS, type StellarNetwork } from "@stellar-analytics/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerGap {
  startSequence: number;
  endSequence: number;
  gapSize: number;
}

export interface GapReport {
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
  gapsRecovered: number;
  ledgersRecovered: number;
  failures: Array<{ gap: LedgerGap; error: string }>;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Scan the ledgers table for gaps in the sequence.
 * Returns an array of gap ranges.
 */
export async function detectLedgerGaps(
  pool: Pool,
): Promise<LedgerGap[]> {
  const client = await pool.connect();
  try {
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

    const expected = maxSeq - minSeq + 1;
    if (count >= expected) {
      return [];
    }

    const { rows } = await client.query<{ sequence: string }>(
      `SELECT sequence FROM ledgers ORDER BY sequence ASC`,
    );

    const gaps: LedgerGap[] = [];
    let prevSeq = minSeq;

    for (const row of rows) {
      const seq = Number(row.sequence);
      if (seq > prevSeq + 1) {
        gaps.push({
          startSequence: prevSeq + 1,
          endSequence: seq - 1,
          gapSize: seq - prevSeq - 1,
        });
      }
      prevSeq = seq;
    }

    if (prevSeq < maxSeq) {
      gaps.push({
        startSequence: prevSeq + 1,
        endSequence: maxSeq,
        gapSize: maxSeq - prevSeq,
      });
    }

    return gaps;
  } finally {
    client.release();
  }
}

/**
 * Compare the highest ledger in the DB against Horizon's latest.
 * Returns gap ranges that need filling.
 */
export async function detectHorizonLag(
  pool: Pool,
  network: StellarNetwork,
  lastProcessedLedger: number,
): Promise<LedgerGap[]> {
  const horizonUrl = STELLAR_NETWORKS[network].horizonUrl;
  const server = new Horizon.Server(horizonUrl);

  const latestResp = await server.ledgers().order("desc").limit(1).call();
  const horizonSeq = latestResp.records[0]?.sequence ?? 0;

  const gap = horizonSeq - 10 - lastProcessedLedger;
  if (gap <= 1) {
    return [];
  }

  const client = await pool.connect();
  try {
    const startSeq = lastProcessedLedger + 1;
    const endSeq = horizonSeq - 10;

    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM ledgers
       WHERE sequence >= $1 AND sequence <= $2`,
      [startSeq, endSeq],
    );
    const present = Number(countResult.rows[0]?.count ?? 0);
    const expected = endSeq - startSeq + 1;
    const missing = expected - present;

    if (missing <= 0) {
      return [];
    }

    // Find the specific gaps
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
        });
      }
      prevSeq = seq;
    }

    if (prevSeq < endSeq) {
      gaps.push({
        startSequence: prevSeq + 1,
        endSequence: endSeq,
        gapSize: endSeq - prevSeq,
      });
    }

    return gaps;
  } finally {
    client.release();
  }
}

/**
 * Generate a full gap report.
 */
export async function generateGapReport(
  pool: Pool,
  network: StellarNetwork,
  lastProcessedLedger: number | null,
): Promise<GapReport> {
  const [dbGaps, client] = await Promise.all([
    detectLedgerGaps(pool),
    pool.connect(),
  ]);

  let dbMinSequence: number | null = null;
  let dbMaxSequence: number | null = null;
  let dbLedgerCount = 0;

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
       FROM ledgers`,
    );
    dbMinSequence = rows[0]?.min_seq ? Number(rows[0].min_seq) : null;
    dbMaxSequence = rows[0]?.max_seq ? Number(rows[0].max_seq) : null;
    dbLedgerCount = Number(rows[0]?.count ?? 0);
  } finally {
    client.release();
  }

  // Also check horizon lag if we have a last processed ledger
  let horizonGaps: LedgerGap[] = [];
  if (lastProcessedLedger !== null) {
    try {
      horizonGaps = await detectHorizonLag(pool, network, lastProcessedLedger);
    } catch {
      // Horizon might be unreachable
    }
  }

  // Merge gaps
  const allGaps = mergeGaps([...dbGaps, ...horizonGaps]);
  const totalMissing = allGaps.reduce((sum, g) => sum + g.gapSize, 0);

  const horizonLatest = await (async () => {
    try {
      const horizonUrl = STELLAR_NETWORKS[network].horizonUrl;
      const server = new Horizon.Server(horizonUrl);
      const resp = await server.ledgers().order("desc").limit(1).call();
      return resp.records[0]?.sequence ?? 0;
    } catch {
      return 0;
    }
  })();

  return {
    gaps: allGaps,
    totalMissing,
    dbLedgerCount,
    horizonLatestSequence: horizonLatest,
    dbMinSequence,
    dbMaxSequence,
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

/**
 * Recover missing ledgers by backfilling detected gaps.
 *
 * @param pool          Database pool
 * @param network       Stellar network (testnet / mainnet)
 * @param backfillFn    Function that backfills a ledger range (startSeq, endSeq)
 * @param onProgress    Optional progress callback
 */
export async function recoverMissingLedgers(
  pool: Pool,
  network: StellarNetwork,
  backfillFn: (startSeq: number, endSeq: number) => Promise<void>,
  onProgress?: (message: string) => void,
): Promise<GapRecoveryResult> {
  const startTime = Date.now();
  const report = await generateGapReport(pool, network, null);

  const result: GapRecoveryResult = {
    gapsFound: report.gaps.length,
    gapsRecovered: 0,
    ledgersRecovered: 0,
    failures: [],
    durationMs: 0,
  };

  if (report.gaps.length === 0) {
    result.durationMs = Date.now() - startTime;
    onProgress?.("No gaps detected – all ledgers accounted for.");
    return result;
  }

  onProgress?.(
    `Found ${report.gaps.length} gap(s) totaling ${report.totalMissing} missing ledgers.`,
  );

  const sortedGaps = [...report.gaps].sort(
    (a, b) => a.startSequence - b.startSequence,
  );

  for (const gap of sortedGaps) {
    try {
      onProgress?.(
        `Recovering gap: ledger ${gap.startSequence} → ${gap.endSequence} (${gap.gapSize} ledgers)`,
      );

      await backfillFn(gap.startSequence, gap.endSequence);

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
        : ""),
  );

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mergeGaps(gaps: LedgerGap[]): LedgerGap[] {
  if (gaps.length <= 1) return gaps;

  const sorted = [...gaps].sort((a, b) => {
    if (a.startSequence !== b.startSequence) {
      return a.startSequence - b.startSequence;
    }
    return b.endSequence - a.endSequence;
  });

  const merged: LedgerGap[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.startSequence <= last.endSequence + 1) {
      merged[merged.length - 1] = {
        startSequence: Math.min(last.startSequence, current.startSequence),
        endSequence: Math.max(last.endSequence, current.endSequence),
        gapSize: Math.max(last.endSequence, current.endSequence) -
          Math.min(last.startSequence, current.startSequence) + 1,
      };
    } else {
      merged.push(current);
    }
  }

  return merged;
}
