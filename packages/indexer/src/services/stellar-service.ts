import { Horizon, Server } from '@stellar/stellar-sdk';
import { Ledger, Transaction, Operation } from '@stellar-analytics/shared';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker/CircuitBreaker';
import { metrics } from '../metrics/IndexerMetrics';
import {
  getRetryConfig,
  isTransientError,
  calculateBackoffMs,
  type HorizonEndpoint,
} from './retry-config';

// Re-export for convenience
export { getRetryConfig, isTransientError, calculateBackoffMs } from './retry-config';

export interface StellarServiceOptions {
  /**
   * Horizon API failure threshold before circuit breaker opens.
   * Default: 5
   */
  circuitBreakerFailureThreshold?: number;
  /**
   * Circuit breaker cooldown in ms before trying again.
   * Default: 300_000 (5 minutes)
   */
  circuitBreakerCooldownMs?: number;
  /**
   * Consecutive successes needed to close the circuit.
   * Default: 2
   */
  circuitBreakerSuccessThreshold?: number;
}

export class StellarService {
  private server: Server;
  private horizonUrl: string;
  private circuitBreaker: CircuitBreaker;
  private retryConfig = getRetryConfig();

  constructor(
    horizonUrl: string,
    options: StellarServiceOptions = {},
  ) {
    this.horizonUrl = horizonUrl;
    this.server = new Server(horizonUrl);
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: options.circuitBreakerFailureThreshold ?? 5,
      cooldownMs: options.circuitBreakerCooldownMs ?? 300_000, // 5 minutes
      successThreshold: options.circuitBreakerSuccessThreshold ?? 2,
      name: 'HorizonAPI',
    });

    console.log(
      `[StellarService] retry config: max=${this.retryConfig.maxAttempts}, ` +
        `base=${this.retryConfig.baseDelayMs}ms, ` +
        `maxDelay=${this.retryConfig.maxDelayMs}ms, ` +
        `jitter=${this.retryConfig.jitter}`,
    );
  }

  /**
   * Retry `fn` with jittered exponential backoff.
   *
   * - Only transient errors (network failures, 5xx, 429) are retried.
   * - Permanent errors (4xx) are rejected immediately.
   * - Each retry attempt is logged and counted via Prometheus metrics.
   * - The configured `maxAttempts` includes the initial call.
   */
  private async retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await fn();
      } catch (err) {
        attempt += 1;

        // Check if we should retry
        if (!isTransientError(err)) {
          metrics.horizonRetriesTotal.inc({ endpoint: 'unknown', result: 'permanent_error' });
          throw err;
        }

        if (attempt >= this.retryConfig.maxAttempts) {
          metrics.horizonRetriesTotal.inc({ endpoint: 'unknown', result: 'exhausted' });
          console.error(
            `[StellarService] retry exhausted after ${attempt} attempts: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          throw err;
        }

        // Calculate backoff with jitter
        const delayMs = calculateBackoffMs(attempt, this.retryConfig);

        metrics.horizonRetriesTotal.inc({ endpoint: 'unknown', result: 'retry' });

        console.warn(
          `[StellarService] request failed (attempt ${attempt}/${this.retryConfig.maxAttempts}), ` +
            `retrying in ${delayMs}ms: ${
              err instanceof Error ? err.message : String(err)
            }`,
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Execute `fn` through the circuit breaker then with retry logic.
   */
  private executeWithRetry<T>(fn: () => Promise<T>, endpoint?: HorizonEndpoint): Promise<T> {
    return this.circuitBreaker.execute(() =>
      this.retryWithBackoff(() => {
        // Track which endpoint was called
        if (endpoint) {
          metrics.horizonRequestsTotal.inc({ endpoint });
        }
        return fn();
      }),
    );
  }

  async getLatestLedger(): Promise<Horizon.ServerApi.LedgerRecord> {
    return this.executeWithRetry(() =>
      this.server.ledgers().order('desc').limit(1).call()
    );
  }

  async getLedgers(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.LedgerRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.ledgers().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getLedger(sequence: number): Promise<Horizon.ServerApi.LedgerRecord> {
    return this.executeWithRetry(() =>
      this.server.ledgers().ledger(sequence).call()
    );
  }

  async getTransactionsForLedger(ledgerSequence: number): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.executeWithRetry(() =>
      this.server.transactions()
        .forLedger(ledgerSequence)
        .order('asc')
        .limit(200)
        .call()
    );
  }

  async getTransactions(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.transactions().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getTransaction(hash: string): Promise<Horizon.ServerApi.TransactionRecord> {
    return this.executeWithRetry(() =>
      this.server.transactions().transaction(hash).call()
    );
  }

  async getOperationsForTransaction(transactionHash: string): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.executeWithRetry(() =>
      this.server.operations()
        .forTransaction(transactionHash)
        .order('asc')
        .limit(100)
        .call()
    );
  }

  async getOperations(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.operations().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getOperationsForLedger(ledgerSequence: number): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.executeWithRetry(() =>
      this.server.operations()
        .forLedger(ledgerSequence)
        .order('asc')
        .limit(1000)
        .call()
    );
  }

  async getAccount(accountId: string): Promise<Horizon.ServerApi.AccountRecord> {
    return this.executeWithRetry(() =>
      this.server.accounts().accountId(accountId).call()
    );
  }

  async getAccountTransactions(accountId: string, cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.transactions()
        .forAccount(accountId)
        .order('desc')
        .limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getAccountOperations(accountId: string, cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.operations()
        .forAccount(accountId)
        .order('desc')
        .limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getAssets(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.AssetRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.assets().order('asc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getTrades(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TradeRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.trades().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getEffects(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.EffectRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.effects().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getPayments(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.PaymentOperationRecord>> {
    return this.executeWithRetry(() => {
      let builder = this.server.payments().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  // Stream real-time data
  streamLedgers(onMessage: (ledger: Horizon.ServerApi.LedgerRecord) => void, onError?: (error: Error) => void): void {
    const ledgerStream = this.server.ledgers()
      .cursor('now')
      .stream({
        onmessage: onMessage,
        onerror: onError || ((error) => console.error('Ledger stream error:', error)),
      });
  }

  streamTransactions(onMessage: (transaction: Horizon.ServerApi.TransactionRecord) => void, onError?: (error: Error) => void): void {
    const txStream = this.server.transactions()
      .cursor('now')
      .stream({
        onmessage: onMessage,
        onerror: onError || ((error) => console.error('Transaction stream error:', error)),
      });
  }

  streamOperations(onMessage: (operation: Horizon.ServerApi.OperationRecord) => void, onError?: (error: Error) => void): void {
    const opStream = this.server.operations()
      .cursor('now')
      .stream({
        onmessage: onMessage,
        onerror: onError || ((error) => console.error('Operation stream error:', error)),
      });
  }

  streamPayments(onMessage: (payment: Horizon.ServerApi.PaymentOperationRecord) => void, onError?: (error: Error) => void): void {
    const paymentStream = this.server.payments()
      .cursor('now')
      .stream({
        onmessage: onMessage,
        onerror: onError || ((error) => console.error('Payment stream error:', error)),
      });
  }

  // Utility methods
  getServer(): Server {
    return this.server;
  }

  getHorizonUrl(): string {
    return this.horizonUrl;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.circuitBreaker.execute(() => this.server.root().call());
      return true;
    } catch (error) {
      console.error('Failed to connect to Horizon:', error);
      return false;
    }
  }

  /**
   * Get the current state of the circuit breaker.
   * Useful for monitoring and alerting.
   */
  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  /**
   * Get detailed statistics about the circuit breaker.
   * Useful for observability and debugging.
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }

  /**
   * Manually reset the circuit breaker (e.g., from an admin endpoint).
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }
}
