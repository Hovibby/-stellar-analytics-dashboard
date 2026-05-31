/**
 * Alerting system types and enums.
 * 
 * Issue #143 – Add alerting for indexer errors
 */

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum AlertChannel {
  SLACK = 'slack',
  EMAIL = 'email',
}

export interface AlertPayload {
  severity: AlertSeverity;
  title: string;
  message: string;
  details?: Record<string, any>;
  timestamp?: Date;
}

export interface AlertProviderConfig {
  enabled: boolean;
  cooldownMs?: number; // Prevent alert spam for the same error
}

export interface SlackAlertConfig extends AlertProviderConfig {
  webhookUrl?: string;
}

export interface EmailAlertConfig extends AlertProviderConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  fromAddress?: string;
  toAddresses?: string[];
}

export interface AlertServiceConfig {
  enabled: boolean;
  channels: {
    slack?: SlackAlertConfig;
    email?: EmailAlertConfig;
  };
  // Severity thresholds for automatic alerts
  thresholds?: {
    errorRatePercent?: number; // Alert if error rate exceeds this %
    deadLetterQueueSize?: number; // Alert if DLQ exceeds this size
    circuitBreakerOpen?: boolean; // Alert when circuit breaker opens
  };
}

export interface IAlertProvider {
  send(payload: AlertPayload): Promise<void>;
  isEnabled(): boolean;
}
