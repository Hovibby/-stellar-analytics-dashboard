/**
 * Central alert service for indexer error notifications.
 * 
 * Issue #143 – Add alerting for indexer errors
 * 
 * Coordinates sending alerts through multiple channels (Slack, Email, etc.)
 * with cooldown management and severity handling.
 */

import { createChildLogger } from '../logger';
import { SlackAlertProvider } from './providers/SlackProvider';
import { EmailAlertProvider } from './providers/EmailProvider';
import type {
  AlertServiceConfig,
  AlertPayload,
  IAlertProvider,
  AlertSeverity,
} from './types';
import { AlertChannel } from './types';

const alertLogger = createChildLogger({ module: 'alerting' });

export class AlertService {
  private enabled: boolean;
  private providers: Map<AlertChannel, IAlertProvider> = new Map();
  private config: AlertServiceConfig;

  constructor(config: AlertServiceConfig) {
    this.config = config;
    this.enabled = config.enabled;

    if (!this.enabled) {
      alertLogger.info('Alerting service is disabled');
      return;
    }

    // Initialize providers
    if (config.channels.slack) {
      try {
        const slackProvider = new SlackAlertProvider(config.channels.slack);
        if (slackProvider.isEnabled()) {
          this.providers.set(AlertChannel.SLACK, slackProvider);
          alertLogger.info('Slack alert provider initialized');
        }
      } catch (error: any) {
        alertLogger.error(
          { error: error?.message ?? String(error) },
          'Failed to initialize Slack provider'
        );
      }
    }

    if (config.channels.email) {
      try {
        const emailProvider = new EmailAlertProvider(config.channels.email);
        if (emailProvider.isEnabled()) {
          this.providers.set(AlertChannel.EMAIL, emailProvider);
          alertLogger.info('Email alert provider initialized');
        }
      } catch (error: any) {
        alertLogger.error(
          { error: error?.message ?? String(error) },
          'Failed to initialize Email provider'
        );
      }
    }

    if (this.providers.size === 0) {
      alertLogger.warn('No alert providers are enabled');
      this.enabled = false;
    }
  }

  /**
   * Send an alert through all enabled providers.
   */
  async alert(payload: AlertPayload): Promise<void> {
    if (!this.enabled || this.providers.size === 0) {
      return;
    }

    try {
      // Add timestamp if not provided
      if (!payload.timestamp) {
        payload.timestamp = new Date();
      }

      alertLogger.info(
        {
          title: payload.title,
          severity: payload.severity,
          channels: Array.from(this.providers.keys()),
        },
        'Sending alert'
      );

      // Send to all enabled providers in parallel
      const promises = Array.from(this.providers.values()).map((provider) =>
        provider.send(payload).catch((error) => {
          alertLogger.error(
            { error: error?.message ?? String(error), title: payload.title },
            'Provider send failed'
          );
        })
      );

      await Promise.all(promises);
    } catch (error: any) {
      alertLogger.error(
        { error: error?.message ?? String(error) },
        'Alert dispatch failed'
      );
    }
  }

  /**
   * Alert for circuit breaker open.
   */
  async alertCircuitBreakerOpen(service: string, reason: string): Promise<void> {
    await this.alert({
      severity: 'critical' as AlertSeverity,
      title: `Circuit Breaker Opened: ${service}`,
      message: `The circuit breaker for ${service} has opened, indicating repeated failures.`,
      details: {
        service,
        reason,
      },
    });
  }

  /**
   * Alert for database connection failure.
   */
  async alertDatabaseError(error: Error, context?: string): Promise<void> {
    await this.alert({
      severity: 'critical' as AlertSeverity,
      title: 'Database Connection Error',
      message: `Failed to connect to database${context ? `: ${context}` : ''}`,
      details: {
        error: error.message,
        context,
      },
    });
  }

  /**
   * Alert for high error rate in processing.
   */
  async alertHighErrorRate(
    errorRate: number,
    cycleCount: number,
    errorCount: number
  ): Promise<void> {
    if (
      this.config.thresholds?.errorRatePercent &&
      errorRate > this.config.thresholds.errorRatePercent
    ) {
      await this.alert({
        severity: 'warning' as AlertSeverity,
        title: 'High Error Rate Detected',
        message: `Error rate has exceeded ${this.config.thresholds.errorRatePercent}%`,
        details: {
          errorRate: `${errorRate.toFixed(2)}%`,
          totalCycles: cycleCount,
          totalErrors: errorCount,
        },
      });
    }
  }

  /**
   * Alert for dead letter queue size threshold exceeded.
   */
  async alertDeadLetterQueueThreshold(queueSize: number): Promise<void> {
    if (
      this.config.thresholds?.deadLetterQueueSize &&
      queueSize > this.config.thresholds.deadLetterQueueSize
    ) {
      await this.alert({
        severity: 'warning' as AlertSeverity,
        title: 'Dead Letter Queue Size Threshold Exceeded',
        message: `The dead letter queue has exceeded the configured threshold.`,
        details: {
          currentSize: queueSize,
          threshold: this.config.thresholds.deadLetterQueueSize,
        },
      });
    }
  }

  /**
   * Alert for ledger processing failure.
   */
  async alertLedgerProcessingError(sequence: number, error: Error): Promise<void> {
    await this.alert({
      severity: 'warning' as AlertSeverity,
      title: `Failed to Process Ledger ${sequence}`,
      message: `Ledger processing encountered an error and has been added to the dead letter queue.`,
      details: {
        sequence,
        error: error.message,
      },
    });
  }

  /**
   * Alert for backfill job failure.
   */
  async alertBackfillFailure(
    startSeq: number,
    endSeq: number,
    failedCount: number,
    error?: Error
  ): Promise<void> {
    await this.alert({
      severity: 'warning' as AlertSeverity,
      title: 'Backfill Job Partial Failure',
      message: `Backfill job for ledgers ${startSeq}-${endSeq} encountered failures.`,
      details: {
        startSequence: startSeq,
        endSequence: endSeq,
        failedLedgers: failedCount,
        error: error?.message,
      },
    });
  }

  /**
   * Alert for graceful shutdown.
   */
  async alertGracefulShutdown(reason: string): Promise<void> {
    await this.alert({
      severity: 'info' as AlertSeverity,
      title: 'Indexer Graceful Shutdown',
      message: `The indexer is shutting down gracefully.`,
      details: {
        reason,
      },
    });
  }

  /**
   * Get the enabled status.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the list of enabled providers.
   */
  getEnabledProviders(): AlertChannel[] {
    return Array.from(this.providers.keys());
  }
}

// Export a singleton instance (will be initialized in main)
export let alertService: AlertService | null = null;

export function initializeAlertService(config: AlertServiceConfig): AlertService {
  alertService = new AlertService(config);
  return alertService;
}
