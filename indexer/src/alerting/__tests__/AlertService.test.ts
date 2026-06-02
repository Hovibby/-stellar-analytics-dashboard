/**
 * Tests for the Alert Service
 * 
 * Issue #143 – Add alerting for indexer errors
 */

import { AlertService } from '../src/alerting/AlertService';
import { AlertSeverity, AlertChannel } from '../src/alerting/types';
import { SlackAlertProvider } from '../src/alerting/providers/SlackProvider';
import { EmailAlertProvider } from '../src/alerting/providers/EmailProvider';
import axios from 'axios';
import nodemailer from 'nodemailer';

// Mock dependencies
jest.mock('axios');
jest.mock('nodemailer');
jest.mock('../src/logger.js', () => ({
  createChildLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;

describe('AlertService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('initializes with alerting disabled', () => {
      const config = {
        enabled: false,
        channels: {},
      };
      const service = new AlertService(config);
      expect(service.isEnabled()).toBe(false);
    });

    it('initializes Slack provider when enabled', () => {
      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
          },
        },
      };
      const service = new AlertService(config);
      expect(service.isEnabled()).toBe(true);
      expect(service.getEnabledProviders()).toContain(AlertChannel.SLACK);
    });

    it('initializes Email provider when enabled', () => {
      mockedNodemailer.createTransport.mockReturnValue({
        sendMail: jest.fn(),
      } as any);

      const config = {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpUser: 'user@example.com',
            smtpPassword: 'password',
            toAddresses: ['alert@example.com'],
          },
        },
      };
      const service = new AlertService(config);
      expect(service.isEnabled()).toBe(true);
      expect(service.getEnabledProviders()).toContain(AlertChannel.EMAIL);
    });

    it('skips providers with missing configuration', () => {
      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: undefined,
          },
        },
      };
      const service = new AlertService(config);
      expect(service.getEnabledProviders()).not.toContain(AlertChannel.SLACK);
    });
  });

  describe('alerting methods', () => {
    let service: AlertService;
    const mockSend = jest.fn();

    beforeEach(() => {
      mockedAxios.post.mockResolvedValue({ status: 200 });
      jest.useFakeTimers();

      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
            cooldownMs: 60000,
          },
        },
      };
      service = new AlertService(config);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('sends circuit breaker alert', async () => {
      await service.alertCircuitBreakerOpen('HorizonAPI', 'Connection timeout');
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends database error alert', async () => {
      const error = new Error('Connection refused');
      await service.alertDatabaseError(error, 'health check');
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends high error rate alert', async () => {
      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
          },
        },
        thresholds: {
          errorRatePercent: 10,
        },
      };
      service = new AlertService(config);
      await service.alertHighErrorRate(25, 100, 25);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends DLQ threshold alert', async () => {
      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
          },
        },
        thresholds: {
          deadLetterQueueSize: 50,
        },
      };
      service = new AlertService(config);
      await service.alertDeadLetterQueueThreshold(100);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends ledger processing error alert', async () => {
      const error = new Error('Invalid ledger data');
      await service.alertLedgerProcessingError(123456, error);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends backfill failure alert', async () => {
      const error = new Error('Timeout');
      await service.alertBackfillFailure(100, 200, 50, error);
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('sends graceful shutdown alert', async () => {
      await service.alertGracefulShutdown('SIGTERM');
      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  describe('cooldown mechanism', () => {
    it('respects cooldown period', async () => {
      jest.useFakeTimers();
      mockedAxios.post.mockResolvedValue({ status: 200 });

      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
            cooldownMs: 60000, // 1 minute
          },
        },
      };
      const service = new AlertService(config);

      // First alert should be sent
      await service.alertCircuitBreakerOpen('HorizonAPI', 'Error 1');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);

      // Second alert within cooldown should be throttled
      await service.alertCircuitBreakerOpen('HorizonAPI', 'Error 2');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1); // Still 1

      // After cooldown, should send again
      jest.advanceTimersByTime(61000);
      await service.alertCircuitBreakerOpen('HorizonAPI', 'Error 3');
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('handles Slack provider errors gracefully', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      const config = {
        enabled: true,
        channels: {
          slack: {
            enabled: true,
            webhookUrl: 'https://hooks.slack.com/test',
          },
        },
      };
      const service = new AlertService(config);

      // Should not throw
      await expect(
        service.alertCircuitBreakerOpen('HorizonAPI', 'Error')
      ).resolves.not.toThrow();
    });

    it('handles email provider errors gracefully', async () => {
      mockedNodemailer.createTransport.mockReturnValue({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP error')),
      } as any);

      const config = {
        enabled: true,
        channels: {
          email: {
            enabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            toAddresses: ['alert@example.com'],
          },
        },
      };
      const service = new AlertService(config);

      // Should not throw
      await expect(
        service.alertDatabaseError(new Error('DB error'))
      ).resolves.not.toThrow();
    });

    it('does not alert when alerting is disabled', async () => {
      const config = {
        enabled: false,
        channels: {},
      };
      const service = new AlertService(config);
      await service.alert({
        severity: AlertSeverity.CRITICAL,
        title: 'Test Alert',
        message: 'This should not be sent',
      });

      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });
});

describe('SlackAlertProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates formatted Slack message', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200 });

    const config = {
      enabled: true,
      webhookUrl: 'https://hooks.slack.com/test',
    };
    const provider = new SlackAlertProvider(config);

    await provider.send({
      severity: AlertSeverity.CRITICAL,
      title: 'Test Alert',
      message: 'This is a test',
      details: {
        service: 'HorizonAPI',
        error: 'Connection timeout',
      },
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://hooks.slack.com/test',
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({
            title: 'Test Alert',
            color: '#FF0000', // Red for CRITICAL
          }),
        ]),
      }),
      expect.any(Object)
    );
  });

  it('disables when webhookUrl is missing', () => {
    const config = {
      enabled: true,
      webhookUrl: undefined,
    };
    const provider = new SlackAlertProvider(config);
    expect(provider.isEnabled()).toBe(false);
  });
});

describe('EmailAlertProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates formatted email message', async () => {
    const mockSendMail = jest.fn().mockResolvedValue({ messageId: '123' });
    mockedNodemailer.createTransport.mockReturnValue({
      sendMail: mockSendMail,
    } as any);

    const config = {
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'user@example.com',
      smtpPassword: 'password',
      toAddresses: ['alert@example.com'],
    };
    const provider = new EmailAlertProvider(config);

    await provider.send({
      severity: AlertSeverity.WARNING,
      title: 'Warning Alert',
      message: 'This is a warning',
      details: {
        errorRate: '15%',
      },
    });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alert@example.com',
        subject: '[WARNING] Warning Alert',
        html: expect.stringContaining('Warning Alert'),
      })
    );
  });

  it('disables when SMTP host is missing', () => {
    mockedNodemailer.createTransport.mockReturnValue({} as any);

    const config = {
      enabled: true,
      smtpHost: undefined,
      toAddresses: ['alert@example.com'],
    };
    const provider = new EmailAlertProvider(config);
    expect(provider.isEnabled()).toBe(false);
  });

  it('disables when no email recipients configured', () => {
    mockedNodemailer.createTransport.mockReturnValue({} as any);

    const config = {
      enabled: true,
      smtpHost: 'smtp.example.com',
      toAddresses: [],
    };
    const provider = new EmailAlertProvider(config);
    expect(provider.isEnabled()).toBe(false);
  });
});
