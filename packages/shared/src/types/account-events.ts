import { z } from 'zod';

/**
 * Account event types that can be captured from Stellar network operations.
 *
 * These represent meaningful state changes to an account that downstream
 * consumers (analytics, audit, notification) care about.
 */
export const AccountEventTypeSchema = z.enum([
  'account_created',
  'account_merged',
  'balance_changed',
  'signers_updated',
  'thresholds_updated',
  'home_domain_updated',
  'inflation_destination_updated',
  'flags_updated',
  'sponsorship_updated',
  'trustline_added',
  'trustline_removed',
  'trustline_updated',
  'data_added',
  'data_removed',
  'data_updated',
  'sequence_bumped',
]);

export type AccountEventType = z.infer<typeof AccountEventTypeSchema>;

/**
 * A single account-level event captured from the Stellar network.
 *
 * `previousValue` and `newValue` store the relevant changed state as
 * JSON so the schema can evolve without migrations.
 */
export const AccountEventSchema = z.object({
  id: z.string(),
  account_id: z.string(),
  type: AccountEventTypeSchema,
  ledger_sequence: z.number().int().positive(),
  transaction_hash: z.string(),
  created_at: z.string().datetime({ offset: true }),
  previous_value: z.any().optional().nullable(),
  new_value: z.any().optional().nullable(),
  details: z.any().optional().nullable(),
});

export type AccountEvent = z.infer<typeof AccountEventSchema>;

/**
 * Database row shape for the account_events table.
 * Same as AccountEvent but with timestamps.
 */
export const DatabaseAccountEventSchema = AccountEventSchema.extend({
  row_created_at: z.string().datetime({ offset: true }).optional(),
  updated_at: z.string().datetime({ offset: true }).optional(),
});

export type DatabaseAccountEvent = z.infer<typeof DatabaseAccountEventSchema>;

/**
 * Human-readable labels for account event types.
 */
export const ACCOUNT_EVENT_TYPE_LABELS: Record<AccountEventType, string> = {
  account_created: 'Account Created',
  account_merged: 'Account Merged',
  balance_changed: 'Balance Changed',
  signers_updated: 'Signers Updated',
  thresholds_updated: 'Thresholds Updated',
  home_domain_updated: 'Home Domain Updated',
  inflation_destination_updated: 'Inflation Destination Updated',
  flags_updated: 'Flags Updated',
  sponsorship_updated: 'Sponsorship Updated',
  trustline_added: 'Trustline Added',
  trustline_removed: 'Trustline Removed',
  trustline_updated: 'Trustline Updated',
  data_added: 'Data Entry Added',
  data_removed: 'Data Entry Removed',
  data_updated: 'Data Entry Updated',
  sequence_bumped: 'Sequence Bumped',
};

/**
 * Maps Stellar operation types to the account event type they produce.
 */
export const OPERATION_TO_ACCOUNT_EVENT_TYPE: Record<string, AccountEventType> = {
  create_account: 'account_created',
  account_merge: 'account_merged',
  set_options: 'signers_updated',
  bump_sequence: 'sequence_bumped',
  change_trust: 'trustline_added',
  manage_data: 'data_added',
  begin_sponsoring_future_reserves: 'sponsorship_updated',
  end_sponsoring_future_reserves: 'sponsorship_updated',
  revoke_sponsorship: 'sponsorship_updated',
};
