/**
 * Issue #36 – Indexer Error Recovery
 *
 * Recovery job to process ledgers from the dead letter queue.
 */

import { dlq, type RetryableLedger } from './DeadLetterQueue.js';
// import { metrics } from '../metrics/IndexerMetrics.js';

export class RecoveryJob {
  private isProcessing = false;

  constructor(private retryProcessor: (sequence: number) => Promise<boolean>) {}

  /**
   * Start the recovery job that periodically checks the dead letter queue
   * and attempts to reprocess failed ledgers.
   */
  async start(intervalMs: number = 60_000): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const processRetryQueue = async () => {
      if (!this.isProcessing) return;

      const readyLedgers = dlq.getReadyForRetry();
      for (const ledger of readyLedgers) {
        const success = await this.retryProcessor(ledger.sequence);
        if (success) {
          dlq.remove(ledger.sequence);
          // metrics.errorsTotal.inc({ type: 'dlq_retry_success' });
        } else {
          // metrics.errorsTotal.inc({ type: 'dlq_retry_failed' });
        }
      }
    };

    // Initial processing
    await processRetryQueue();

    // Periodic processing
    setInterval(processRetryQueue, intervalMs);
  }

  /**
   * Stop the recovery job
   */
  stop(): void {
    this.isProcessing = false;
  }

  /**
   * Get statistics about the recovery job
   */
  getStats(): {
    failedLedgersCount: number;
    isProcessing: boolean;
    ledgers: ReturnType<typeof dlq.getAll>;
  } {
    return {
      failedLedgersCount: dlq.size(),
      isProcessing: this.isProcessing,
      ledgers: dlq.getAll(),
    };
  }
}