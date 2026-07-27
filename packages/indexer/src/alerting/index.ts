/**
 * Alerting module - exports all alerting types and services.
 */

export { AlertService, initializeAlertService, alertService } from './AlertService';
export type {
  AlertPayload,
  AlertServiceConfig,
  SlackAlertConfig,
  EmailAlertConfig,
  AlertProviderConfig,
  IAlertProvider,
} from './types';
export { AlertSeverity, AlertChannel } from './types';
export { SlackAlertProvider } from './providers/SlackProvider';
export { EmailAlertProvider } from './providers/EmailProvider';
