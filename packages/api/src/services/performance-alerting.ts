/**
 * Performance Alerting Service
 *
 * Monitors API and GraphQL response times and fires alerts (Slack / Email)
 * when latency degrades beyond configurable thresholds.
 *
 * Integration points
 * ------------------
 *  • Apollo Server plugin  – tracks GraphQL operation duration
 *  • Express middleware    – tracks overall HTTP request duration
 *  • Health-check poller  – periodically checks DB/Redis latency via healthCheckFn
 *
 * Configuration (environment variables)
 * --------------------------------------
 *  PERF_ALERTING_ENABLED          = true    Enable/disable (default: false)
 *  PERF_SLOW_GRAPHQL_WARN_MS      = 1000    Warn threshold for GraphQL ops (ms)
 *  PERF_SLOW_GRAPHQL_CRITICAL_MS  = 5000    Critical threshold for GraphQL ops (ms)
 *  PERF_SLOW_HTTP_WARN_MS         = 2000    Warn threshold for HTTP requests (ms)
 *  PERF_SLOW_HTTP_CRITICAL_MS     = 10000   Critical threshold for HTTP requests (ms)
 *  PERF_SLOW_DB_WARN_MS           = 500     Warn threshold for DB health latency (ms)
 *  PERF_SLOW_DB_CRITICAL_MS       = 2000    Critical threshold for DB health latency (ms)
 *  PERF_ALERT_COOLDOWN_MS         = 300000  Minimum ms between identical alerts (5 min)
 *  PERF_HEALTH_POLL_INTERVAL_MS   = 60000   How often to poll health (1 min)
 *  SLACK_WEBHOOK_URL              =         Slack webhook (shared with indexer alerting)
 *  EMAIL_SMTP_*                   =         SMTP config (shared with indexer alerting)
 */

import https from 'https';
import http from 'http';
import nodemailer from 'nodemailer';
import winston from 'winston';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = 'warn' | 'critical';

export interface PerfAlertPayload {
  severity: AlertSeverity;
  category: 'graphql' | 'http' | 'database' | 'health';
  operation: string;
  durationMs: number;
  thresholdMs: number;
  details?: Record<string, unknown>;
  timestamp: Date;
}

interface SlackConfig {
  webhookUrl: string;
}

interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromAddress: string;
  toAddresses: string[];
}

export interface PerfAlertingConfig {
  enabled: boolean;
  thresholds: {
    graphqlWarnMs: number;
    graphqlCriticalMs: number;
    httpWarnMs: number;
    httpCriticalMs: number;
    dbWarnMs: number;
    dbCriticalMs: number;
  };
  cooldownMs: number;
  healthPollIntervalMs: number;
  slack?: SlackConfig;
  email?: EmailConfig;
}

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

export function buildPerfAlertingConfig(): PerfAlertingConfig {
  const slackWebhook = process.env.SLACK_WEBHOOK_URL;
  const smtpHost = process.env.EMAIL_SMTP_HOST;
  const smtpUser = process.env.EMAIL_SMTP_USER;
  const smtpPassword = process.env.EMAIL_SMTP_PASSWORD;
  const toAddresses = process.env.EMAIL_TO_ADDRESSES;

  const slack: SlackConfig | undefined = slackWebhook
    ? { webhookUrl: slackWebhook }
    : undefined;

  const email: EmailConfig | undefined =
    smtpHost && smtpUser && smtpPassword && toAddresses
      ? {
          smtpHost,
          smtpPort: Number(process.env.EMAIL_SMTP_PORT ?? 587),
          smtpUser,
          smtpPassword,
          fromAddress: process.env.EMAIL_FROM_ADDRESS ?? smtpUser,
          toAddresses: toAddresses.split(',').map((s) => s.trim()),
        }
      : undefined;

  return {
    enabled: process.env.PERF_ALERTING_ENABLED === 'true',
    thresholds: {
      graphqlWarnMs: Number(process.env.PERF_SLOW_GRAPHQL_WARN_MS ?? 1000),
      graphqlCriticalMs: Number(process.env.PERF_SLOW_GRAPHQL_CRITICAL_MS ?? 5000),
      httpWarnMs: Number(process.env.PERF_SLOW_HTTP_WARN_MS ?? 2000),
      httpCriticalMs: Number(process.env.PERF_SLOW_HTTP_CRITICAL_MS ?? 10000),
      dbWarnMs: Number(process.env.PERF_SLOW_DB_WARN_MS ?? 500),
      dbCriticalMs: Number(process.env.PERF_SLOW_DB_CRITICAL_MS ?? 2000),
    },
    cooldownMs: Number(process.env.PERF_ALERT_COOLDOWN_MS ?? 300_000),
    healthPollIntervalMs: Number(process.env.PERF_HEALTH_POLL_INTERVAL_MS ?? 60_000),
    slack,
    email,
  };
}

// ---------------------------------------------------------------------------
// PerformanceAlertingService
// ---------------------------------------------------------------------------

export class PerformanceAlertingService {
  private readonly config: PerfAlertingConfig;
  private readonly logger: winston.Logger;
  /** Cooldown map: alert key → timestamp last sent (ms) */
  private readonly lastSent = new Map<string, number>();
  private healthPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: PerfAlertingConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Called by the Apollo Server plugin after every GraphQL operation.
   */
  onGraphQLOperation(operationName: string, durationMs: number): void {
    if (!this.config.enabled) return;
    const { graphqlWarnMs, graphqlCriticalMs } = this.config.thresholds;

    if (durationMs >= graphqlCriticalMs) {
      this.fireAlert({
        severity: 'critical',
        category: 'graphql',
        operation: operationName,
        durationMs,
        thresholdMs: graphqlCriticalMs,
        timestamp: new Date(),
      });
    } else if (durationMs >= graphqlWarnMs) {
      this.fireAlert({
        severity: 'warn',
        category: 'graphql',
        operation: operationName,
        durationMs,
        thresholdMs: graphqlWarnMs,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Called by the Express performance middleware after every HTTP response.
   */
  onHttpRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    if (!this.config.enabled) return;
    const { httpWarnMs, httpCriticalMs } = this.config.thresholds;
    const operation = `${method} ${path}`;

    if (durationMs >= httpCriticalMs) {
      this.fireAlert({
        severity: 'critical',
        category: 'http',
        operation,
        durationMs,
        thresholdMs: httpCriticalMs,
        details: { statusCode },
        timestamp: new Date(),
      });
    } else if (durationMs >= httpWarnMs) {
      this.fireAlert({
        severity: 'warn',
        category: 'http',
        operation,
        durationMs,
        thresholdMs: httpWarnMs,
        details: { statusCode },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Called during periodic health checks with DB / Redis latency values.
   */
  onDatabaseLatency(label: string, latencyMs: number): void {
    if (!this.config.enabled) return;
    const { dbWarnMs, dbCriticalMs } = this.config.thresholds;

    if (latencyMs >= dbCriticalMs) {
      this.fireAlert({
        severity: 'critical',
        category: 'database',
        operation: label,
        durationMs: latencyMs,
        thresholdMs: dbCriticalMs,
        timestamp: new Date(),
      });
    } else if (latencyMs >= dbWarnMs) {
      this.fireAlert({
        severity: 'warn',
        category: 'database',
        operation: label,
        durationMs: latencyMs,
        thresholdMs: dbWarnMs,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Start periodic health polling.
   * Pass a `healthCheckFn` so the service stays decoupled from the HTTP layer.
   */
  startHealthPolling(
    healthCheckFn: () => Promise<{
      postgres: { latencyMs: number };
      redis: { latencyMs: number };
    }>
  ): void {
    if (!this.config.enabled) return;
    if (this.healthPollTimer) return;

    this.healthPollTimer = setInterval(() => {
      healthCheckFn()
        .then((health) => {
          this.onDatabaseLatency('postgres', health.postgres.latencyMs);
          this.onDatabaseLatency('redis', health.redis.latencyMs);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error('[perf-alerting] health poll failed', { error: message });
        });
    }, this.config.healthPollIntervalMs);

    this.logger.info(
      `[perf-alerting] health polling started (interval=${this.config.healthPollIntervalMs}ms)`
    );
  }

  stopHealthPolling(): void {
    if (this.healthPollTimer) {
      clearInterval(this.healthPollTimer);
      this.healthPollTimer = null;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private fireAlert(payload: PerfAlertPayload): void {
    const key = `${payload.category}:${payload.operation}:${payload.severity}`;
    const now = Date.now();
    const last = this.lastSent.get(key) ?? 0;

    if (now - last < this.config.cooldownMs) {
      return;
    }
    this.lastSent.set(key, now);

    if (payload.severity === 'critical') {
      this.logger.error('[perf-alerting] latency threshold breached', {
        category: payload.category,
        operation: payload.operation,
        durationMs: payload.durationMs,
        thresholdMs: payload.thresholdMs,
        severity: payload.severity,
      });
    } else {
      this.logger.warn('[perf-alerting] latency threshold breached', {
        category: payload.category,
        operation: payload.operation,
        durationMs: payload.durationMs,
        thresholdMs: payload.thresholdMs,
        severity: payload.severity,
      });
    }

    // Dispatch asynchronously — do not block the request path
    this.dispatch(payload).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('[perf-alerting] dispatch failed', { error: message });
    });
  }

  private async dispatch(payload: PerfAlertPayload): Promise<void> {
    const promises: Promise<void>[] = [];
    if (this.config.slack) promises.push(this.sendSlack(payload, this.config.slack));
    if (this.config.email) promises.push(this.sendEmail(payload, this.config.email));
    await Promise.allSettled(promises);
  }

  // ── Slack ─────────────────────────────────────────────────────────────────

  private sendSlack(payload: PerfAlertPayload, slackCfg: SlackConfig): Promise<void> {
    const color = payload.severity === 'critical' ? '#ff0000' : '#ffaa00';
    const icon = payload.severity === 'critical' ? '🔴' : '🟠';
    const title = `${icon} [${payload.severity.toUpperCase()}] Slow ${payload.category.toUpperCase()}: ${payload.operation}`;

    const detailFields: Array<{ title: string; value: string; short: boolean }> = payload.details
      ? Object.entries(payload.details).map(([k, v]) => ({
          title: k,
          value: String(v),
          short: true,
        }))
      : [];

    const body = JSON.stringify({
      attachments: [
        {
          color,
          title,
          fields: [
            { title: 'Duration', value: `${payload.durationMs.toFixed(1)} ms`, short: true },
            { title: 'Threshold', value: `${payload.thresholdMs} ms`, short: true },
            { title: 'Category', value: payload.category, short: true },
            { title: 'Timestamp', value: payload.timestamp.toISOString(), short: true },
            ...detailFields,
          ],
          footer: 'Stellar Analytics API',
          ts: Math.floor(payload.timestamp.getTime() / 1000),
        },
      ],
    });

    return new Promise<void>((resolve, reject) => {
      const webhookUrl = new URL(slackCfg.webhookUrl);
      const options = {
        hostname: webhookUrl.hostname,
        path: webhookUrl.pathname + webhookUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const transport = webhookUrl.protocol === 'https:' ? https : http;
      const req = transport.request(options, (res) => {
        res.resume();
        res.on('end', resolve);
      });

      req.on('error', reject);
      req.setTimeout(5000, () => {
        req.destroy(new Error('Slack request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  private async sendEmail(payload: PerfAlertPayload, emailCfg: EmailConfig): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: emailCfg.smtpHost,
      port: emailCfg.smtpPort,
      secure: emailCfg.smtpPort === 465,
      auth: { user: emailCfg.smtpUser, pass: emailCfg.smtpPassword },
    });

    const severityLabel = payload.severity.toUpperCase();
    const subject = `[${severityLabel}] Slow ${payload.category}: ${payload.operation} (${payload.durationMs.toFixed(0)}ms)`;

    const detailRows = payload.details
      ? Object.entries(payload.details)
          .map(([k, v]) => `<tr><td><strong>${k}</strong></td><td>${String(v)}</td></tr>`)
          .join('')
      : '';

    const headerColor = payload.severity === 'critical' ? '#cc0000' : '#ee6600';
    const html = `
      <h2 style="color:${headerColor}">Performance Alert – ${severityLabel}</h2>
      <table border="1" cellpadding="6" style="border-collapse:collapse">
        <tr><td><strong>Category</strong></td><td>${payload.category}</td></tr>
        <tr><td><strong>Operation</strong></td><td>${payload.operation}</td></tr>
        <tr><td><strong>Duration</strong></td><td>${payload.durationMs.toFixed(1)} ms</td></tr>
        <tr><td><strong>Threshold</strong></td><td>${payload.thresholdMs} ms</td></tr>
        <tr><td><strong>Timestamp</strong></td><td>${payload.timestamp.toISOString()}</td></tr>
        ${detailRows}
      </table>
      <p style="color:#666;font-size:12px">Stellar Analytics API – Performance Alerting</p>
    `;

    await transporter.sendMail({
      from: emailCfg.fromAddress,
      to: emailCfg.toAddresses.join(', '),
      subject,
      html,
    });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _service: PerformanceAlertingService | null = null;

export function initPerfAlerting(logger: winston.Logger): PerformanceAlertingService {
  _service = new PerformanceAlertingService(buildPerfAlertingConfig(), logger);
  return _service;
}

export function getPerfAlerting(): PerformanceAlertingService | null {
  return _service;
}
