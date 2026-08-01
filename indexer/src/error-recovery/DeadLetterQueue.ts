import fs from 'fs';
import path from 'path';

const DLQ_FILE = path.join(__dirname, '../../..', 'dead-letter-queue.log');

/**
 * Issue #36 – Indexer Error Recovery
 *
 * Dead letter queue for failed ledger processing with exponential backoff retry.
 */

export interface RetryableLedger {
  sequence: number;
  attemptCount: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  lastError: string;
}

export class DeadLetterQueue {
  private failedLedgers: RetryableLedger[] = [];
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;

  constructor(options?: { maxRetries?: number; baseDelayMs?: number }) {
    this.maxRetries = options?.maxRetries ?? 5;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
  }

  /**
   * Add a failed ledger to the dead letter queue
   */
  push(sequence: number, error: string): void {
    const now = new Date();
    const existing = this.failedLedgers.find((l) => l.sequence === sequence);

    if (existing) {
      existing.attemptCount++;
      existing.lastFailedAt = now;
      existing.lastError = error;

      if (existing.attemptCount >= this.maxRetries) {
        this.writeToDlqFile(existing);
        this.remove(existing.sequence);
      }
    } else {
      this.failedLedgers.push({
        sequence,
        attemptCount: 1,
        firstFailedAt: now,
        lastFailedAt: now,
        lastError: error,
      });
    }
  }

  /**
   * Get ledgers ready for retry with exponential backoff
   */
  getReadyForRetry(now: Date = new Date()): RetryableLedger[] {
    return this.failedLedgers.filter((ledger) => {
      if (ledger.attemptCount >= this.maxRetries) return false;
      const backoffMs = this.calculateBackoff(ledger.attemptCount);
      const readyTime = ledger.lastFailedAt.getTime() + backoffMs;
      return now.getTime() >= readyTime;
    });
  }

  /**
   * Remove a ledger after successful retry
   */
  remove(sequence: number): void {
    this.failedLedgers = this.failedLedgers.filter((l) => l.sequence !== sequence);
  }

  /**
   * Get all failed ledgers
   */
  getAll(): RetryableLedger[] {
    return [...this.failedLedgers];
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** attempt, 300_000);
  }

  size(): number {
    return this.failedLedgers.length;
  }

  private writeToDlqFile(ledger: RetryableLedger): void {
    const logEntry = `[${new Date().toISOString()}] Terminally failed ledger: ${JSON.stringify(
      ledger
    )}\n`;
    fs.appendFileSync(DLQ_FILE, logEntry);
  }
}

export const dlq = new DeadLetterQueue();
