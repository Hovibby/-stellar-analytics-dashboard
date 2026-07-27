/**
 * Issue #216 – API Circuit Breaker
 *
 * Wraps async operations (database queries, external API calls) with circuit
 * breaker protection. Three states:
 *
 *   CLOSED   – normal operation; failures are counted.
 *   OPEN     – threshold exceeded; calls are rejected immediately.
 *   HALF_OPEN – cooldown elapsed; one probe call is allowed through.
 *
 * Configuration (all optional, sensible defaults provided):
 *   failureThreshold   – consecutive failures before opening  (default 5)
 *   cooldownMs         – ms to wait before trying again       (default 5 min)
 *   successThreshold   – successes in HALF_OPEN to re-close   (default 2)
 */

import winston from 'winston';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. Default: 5 */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN state before moving to HALF_OPEN. Default: 300_000 (5 min) */
  cooldownMs?: number;
  /** Consecutive successes in HALF_OPEN needed to close the circuit. Default: 2 */
  successThreshold?: number;
  /** Optional name for log messages. Default: 'CircuitBreaker' */
  name?: string;
  /** Optional logger instance */
  logger?: winston.Logger;
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;

  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly successThreshold: number;
  private readonly name: string;
  private readonly logger?: winston.Logger;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 300_000;
    this.successThreshold = options.successThreshold ?? 2;
    this.name = options.name ?? 'CircuitBreaker';
    this.logger = options.logger;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.transitionIfNeeded();

    if (this.state === 'OPEN') {
      const waitSec = Math.ceil(
        (this.cooldownMs - (Date.now() - (this.lastFailureTime ?? 0))) / 1000
      );
      throw new CircuitOpenError(
        `[${this.name}] Circuit is OPEN. Retry in ~${waitSec}s.`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.logger?.info(`[${this.name}] Circuit manually reset to CLOSED`);
  }

  getState(): CircuitState {
    this.transitionIfNeeded();
    return this.state;
  }

  getStats() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime
        ? new Date(this.lastFailureTime).toISOString()
        : null,
    };
  }

  private transitionIfNeeded(): void {
    if (
      this.state === 'OPEN' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.cooldownMs
    ) {
      this.state = 'HALF_OPEN';
      this.successCount = 0;
      this.logger?.info(`[${this.name}] Circuit transitioned OPEN → HALF_OPEN`);
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.logger?.info(`[${this.name}] Circuit transitioned HALF_OPEN → CLOSED`);
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(err: unknown): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    const message = err instanceof Error ? err.message : String(err);
    this.logger?.warn(`[${this.name}] Failure ${this.failureCount}/${this.failureThreshold}: ${message}`);

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.successCount = 0;
      this.logger?.warn(`[${this.name}] Circuit transitioned HALF_OPEN → OPEN`);
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.logger?.error(
        `[${this.name}] Failure threshold reached. Circuit OPEN. Cooldown: ${this.cooldownMs / 1000}s`
      );
    }
  }
}

// Singleton circuit breakers for the API
let dbCircuitBreaker: CircuitBreaker | null = null;

export function getDbCircuitBreaker(logger?: winston.Logger): CircuitBreaker {
  if (!dbCircuitBreaker) {
    dbCircuitBreaker = new CircuitBreaker({
      name: 'DB',
      failureThreshold: 5,
      cooldownMs: 300_000,
      successThreshold: 2,
      logger,
    });
  }
  return dbCircuitBreaker;
}
