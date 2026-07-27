/**
 * Slack alert provider.
 * 
 * Issue #143 – Add alerting for indexer errors
 */

import axios from 'axios';
import { createChildLogger } from '../logger';
import type { AlertPayload, IAlertProvider, SlackAlertConfig } from './types';
import { AlertSeverity } from './types';

const slackLogger = createChildLogger({ module: 'alerting-slack' });

export class SlackAlertProvider implements IAlertProvider {
  private webhookUrl: string | undefined;
  private enabled: boolean;
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs: number;

  constructor(config: SlackAlertConfig) {
    this.webhookUrl = config.webhookUrl;
    this.enabled = config.enabled && !!this.webhookUrl;
    this.cooldownMs = config.cooldownMs ?? 5 * 60 * 1000; // 5 minutes default
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async send(payload: AlertPayload): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const alertKey = `${payload.severity}:${payload.title}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;

    // Prevent alert spam with cooldown
    if (now - lastAlert < this.cooldownMs) {
      slackLogger.debug(
        { title: payload.title, severity: payload.severity },
        'Alert throttled by cooldown'
      );
      return;
    }

    try {
      const color = this.getColorForSeverity(payload.severity);
      const message = this.buildSlackMessage(payload, color);

      await axios.post(this.webhookUrl!, message, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      });

      this.lastAlertTime.set(alertKey, now);

      slackLogger.debug(
        { title: payload.title, severity: payload.severity },
        'Alert sent to Slack'
      );
    } catch (error: any) {
      slackLogger.error(
        {
          title: payload.title,
          error: error?.message ?? String(error),
        },
        'Failed to send Slack alert'
      );
      // Don't throw - alert failure shouldn't crash the indexer
    }
  }

  private getColorForSeverity(severity: AlertSeverity): string {
    switch (severity) {
      case AlertSeverity.CRITICAL:
        return '#FF0000'; // Red
      case AlertSeverity.WARNING:
        return '#FFA500'; // Orange
      case AlertSeverity.INFO:
        return '#00FF00'; // Green
      default:
        return '#808080'; // Gray
    }
  }

  private buildSlackMessage(payload: AlertPayload, color: string): Record<string, any> {
    const fields: Array<{ title: string; value: string; short: boolean }> = [
      {
        title: 'Severity',
        value: payload.severity.toUpperCase(),
        short: true,
      },
      {
        title: 'Timestamp',
        value: (payload.timestamp ?? new Date()).toISOString(),
        short: true,
      },
    ];

    if (payload.details) {
      for (const [key, value] of Object.entries(payload.details)) {
        fields.push({
          title: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
          value: typeof value === 'string' ? value : JSON.stringify(value),
          short: true,
        });
      }
    }

    return {
      attachments: [
        {
          fallback: payload.title,
          color,
          title: payload.title,
          text: payload.message,
          fields,
          footer: 'Stellar Analytics Indexer',
          ts: Math.floor((payload.timestamp ?? new Date()).getTime() / 1000),
        },
      ],
    };
  }
}
