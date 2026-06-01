import { Horizon, Server } from '@stellar/stellar-sdk';
import { Ledger, Transaction, Operation } from '@stellar-analytics/shared';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breaker/CircuitBreaker';

export class StellarService {
  private server: Server;
  private horizonUrl: string;
  private circuitBreaker: CircuitBreaker;

  constructor(horizonUrl: string) {
    this.horizonUrl = horizonUrl;
    this.server = new Server(horizonUrl);
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      cooldownMs: 300_000, // 5 minutes
      successThreshold: 2,
      name: 'HorizonAPI',
    });
  }

  async getLatestLedger(): Promise<Horizon.ServerApi.LedgerRecord> {
    return this.circuitBreaker.execute(() =>
      this.server.ledgers().order('desc').limit(1).call()
    );
  }

  async getLedgers(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.LedgerRecord>> {
    return this.circuitBreaker.execute(() => {
      let builder = this.server.ledgers().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getLedger(sequence: number): Promise<Horizon.ServerApi.LedgerRecord> {
    return this.circuitBreaker.execute(() =>
      this.server.ledgers().ledger(sequence).call()
    );
  }

  async getTransactionsForLedger(ledgerSequence: number): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.circuitBreaker.execute(() =>
      this.server.transactions()
        .forLedger(ledgerSequence)
        .order('asc')
        .limit(200)
        .call()
    );
  }

  async getTransactions(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.circuitBreaker.execute(() => {
      let builder = this.server.transactions().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getTransaction(hash: string): Promise<Horizon.ServerApi.TransactionRecord> {
    return this.circuitBreaker.execute(() =>
      this.server.transactions().transaction(hash).call()
    );
  }

  async getOperationsForTransaction(transactionHash: string): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.circuitBreaker.execute(() =>
      this.server.operations()
        .forTransaction(transactionHash)
        .order('asc')
        .limit(100)
        .call()
    );
  }

  async getOperations(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.circuitBreaker.execute(() => {
      let builder = this.server.operations().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getOperationsForLedger(ledgerSequence: number): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.OperationRecord>> {
    return this.circuitBreaker.execute(() =>
      this.server.operations()
        .forLedger(ledgerSequence)
        .order('asc')
        .limit(1000)
        .call()
    );
  }

  async getAccount(accountId: string): Promise<Horizon.ServerApi.AccountRecord> {
    return this.circuitBreaker.execute(() =>
      this.server.accounts().accountId(accountId).call()
    );
  }

  async getAccountTransactions(accountId: string, cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TransactionRecord>> {
    return this.circuitBreaker.execute(() => {
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
    return this.circuitBreaker.execute(() => {
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
    return this.circuitBreaker.execute(() => {
      let builder = this.server.assets().order('asc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getTrades(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.TradeRecord>> {
    return this.circuitBreaker.execute(() => {
      let builder = this.server.trades().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getEffects(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.EffectRecord>> {
    return this.circuitBreaker.execute(() => {
      let builder = this.server.effects().order('desc').limit(limit);
      if (cursor) {
        builder = builder.cursor(cursor);
      }
      return builder.call();
    });
  }

  async getPayments(cursor?: string, limit: number = 200): Promise<Horizon.ServerApi.CollectionPage<Horizon.ServerApi.PaymentOperationRecord>> {
    return this.circuitBreaker.execute(() => {
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
