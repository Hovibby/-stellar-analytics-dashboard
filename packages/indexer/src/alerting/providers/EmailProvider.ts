/**
 * Email alert provider.
 * 
 * Issue #143 – Add alerting for indexer errors
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { createChildLogger } from '../logger';
import type { AlertPayload, IAlertProvider, EmailAlertConfig } from './types';
import { AlertSeverity } from './types';

const emailLogger = createChildLogger({ module: 'alerting-email' });

export class EmailAlertProvider implements IAlertProvider {
  private transporter: Transporter | undefined;
  private enabled: boolean;
  private fromAddress: string;
  private toAddresses: string[];
  private lastAlertTime: Map<string, number> = new Map();
  private cooldownMs: number;

  constructor(config: EmailAlertConfig) {
    this.cooldownMs = config.cooldownMs ?? 5 * 60 * 1000; // 5 minutes default
    this.toAddresses = config.toAddresses ?? [];
    this.fromAddress = config.fromAddress ?? 'indexer@stellar-analytics.local';

    if (
      config.enabled &&
      config.smtpHost &&
      config.smtpPort &&
      this.toAddresses.length > 0
    ) {
      try {
        this.transporter = nodemailer.createTransport({
          host: config.smtpHost,
          port: config.smtpPort,
          secure: config.smtpPort === 465, // true for 465, false for other ports
          auth: config.smtpUser
            ? {
                user: config.smtpUser,
                pass: config.smtpPassword,
              }
            : undefined,
        });
        this.enabled = true;
      } catch (error: any) {
        emailLogger.error(
          { error: error?.message ?? String(error) },
          'Failed to initialize email transporter'
        );
        this.enabled = false;
      }
    } else {
      this.enabled = false;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async send(payload: AlertPayload): Promise<void> {
    if (!this.isEnabled() || !this.transporter) {
      return;
    }

    const alertKey = `${payload.severity}:${payload.title}`;
    const now = Date.now();
    const lastAlert = this.lastAlertTime.get(alertKey) || 0;

    // Prevent alert spam with cooldown
    if (now - lastAlert < this.cooldownMs) {
      emailLogger.debug(
        { title: payload.title, severity: payload.severity },
        'Alert throttled by cooldown'
      );
      return;
    }

    try {
      const html = this.buildHtmlMessage(payload);
      const subject = `[${payload.severity.toUpperCase()}] ${payload.title}`;

      await this.transporter.sendMail({
        from: this.fromAddress,
        to: this.toAddresses.join(','),
        subject,
        html,
        text: this.buildTextMessage(payload),
      });

      this.lastAlertTime.set(alertKey, now);

      emailLogger.debug(
        {
          title: payload.title,
          severity: payload.severity,
          recipients: this.toAddresses.length,
        },
        'Alert sent via email'
      );
    } catch (error: any) {
      emailLogger.error(
        {
          title: payload.title,
          error: error?.message ?? String(error),
        },
        'Failed to send email alert'
      );
      // Don't throw - alert failure shouldn't crash the indexer
    }
  }

  private buildHtmlMessage(payload: AlertPayload): string {
    const severity = payload.severity.toUpperCase();
    const severityColor = this.getColorForSeverity(payload.severity);

    let detailsHtml = '';
    if (payload.details && Object.keys(payload.details).length > 0) {
      detailsHtml = '<h3>Details:</h3><ul>';
      for (const [key, value] of Object.entries(payload.details)) {
        const formattedKey = key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1');
        const formattedValue =
          typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        detailsHtml += `<li><strong>${formattedKey}:</strong> ${formattedValue}</li>`;
      }
      detailsHtml += '</ul>';
    }

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: ${severityColor}; color: white; padding: 20px; border-radius: 5px; }
            .content { background-color: #f5f5f5; padding: 20px; margin-top: 20px; border-radius: 5px; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h2 style="margin: 0;">${payload.title}</h2>
              <p style="margin: 10px 0 0 0;">Severity: ${severity}</p>
            </div>
            <div class="content">
              <p>${payload.message}</p>
              ${detailsHtml}
            </div>
            <div class="footer">
              <p>Timestamp: ${(payload.timestamp ?? new Date()).toISOString()}</p>
              <p>Stellar Analytics Indexer</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private buildTextMessage(payload: AlertPayload): string {
    let text = `${payload.title}\n`;
    text += `Severity: ${payload.severity.toUpperCase()}\n`;
    text += `Timestamp: ${(payload.timestamp ?? new Date()).toISOString()}\n`;
    text += `\n${payload.message}\n`;

    if (payload.details && Object.keys(payload.details).length > 0) {
      text += '\nDetails:\n';
      for (const [key, value] of Object.entries(payload.details)) {
        const formattedValue =
          typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        text += `  ${key}: ${formattedValue}\n`;
      }
    }

    return text;
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
}
