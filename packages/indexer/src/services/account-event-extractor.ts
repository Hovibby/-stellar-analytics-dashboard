/**
 * AccountEventExtractor
 *
 * Derives discrete account-level events from raw Stellar Horizon operations
 * and produces records suitable for writing to the account_events table.
 *
 * Each Stellar operation type that modifies account state is mapped to one
 * or more account event types with before/after snapshots where available.
 */

import { Horizon } from '@stellar/stellar-sdk';
import { AccountEventType, OPERATION_TO_ACCOUNT_EVENT_TYPE } from '@stellar-analytics/shared';

/**
 * A prepared account event row ready for DB insertion.
 */
export interface AccountEventRow {
  id: string;
  account_id: string;
  type: AccountEventType;
  ledger_sequence: number;
  transaction_hash: string;
  created_at: string;
  previous_value: unknown | null;
  new_value: unknown | null;
  details: unknown | null;
}

/**
 * Extract account events from a single Horizon operation record.
 *
 * Returns an array because some operations (e.g. set_options) can produce
 * multiple distinct events (signers + thresholds + flags + home_domain).
 *
 * Returns an empty array when the operation type does not affect account state.
 */
export function extractAccountEvents(
  operation: Horizon.ServerApi.OperationRecord,
): AccountEventRow[] {
  const events: AccountEventRow[] = [];

  const baseId = `${operation.id}-evt`;
  const ledgerSequence = parseInt(operation.id.split('-')[0], 10);
  const createdAt = operation.created_at;

  switch (operation.type) {
    case 'create_account': {
      const op = operation as Horizon.ServerApi.CreateAccountOperationRecord;
      events.push({
        id: `${baseId}-created`,
        account_id: op.account,
        type: 'account_created',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { balance: op.starting_balance, funder: op.funder },
        details: {
          funder: op.funder,
          starting_balance: op.starting_balance,
          source_account: op.source_account,
        },
      });
      break;
    }

    case 'account_merge': {
      const op = operation as Horizon.ServerApi.AccountMergeOperationRecord;
      events.push({
        id: `${baseId}-merged`,
        account_id: op.source_account,
        type: 'account_merged',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { into: op.into },
        details: {
          into: op.into,
          source_account: op.source_account,
        },
      });
      // Also record an event for the destination account receiving the balance
      events.push({
        id: `${baseId}-dest`,
        account_id: op.into,
        type: 'balance_changed',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { source: op.source_account, merge_amount: null },
        details: {
          source: op.source_account,
          type: 'account_merge_into',
        },
      });
      break;
    }

    case 'set_options': {
      const op = operation as Horizon.ServerApi.SetOptionsOperationRecord;
      // Signer changes
      if (op.signer_key || op.signer_key === null) {
        events.push({
          id: `${baseId}-signers`,
          account_id: op.source_account,
          type: 'signers_updated',
          ledger_sequence: ledgerSequence,
          transaction_hash: op.transaction_hash,
          created_at: createdAt,
          previous_value: null,
          new_value: {
            signer_key: op.signer_key,
            signer_weight: op.signer_weight,
            signer_added: op.signer_weight && op.signer_weight > 0,
            signer_removed: op.signer_key === null,
          },
          details: {
            signer_key: op.signer_key,
            signer_weight: op.signer_weight,
          },
        });
      }

      // Threshold changes
      if (op.low_threshold || op.med_threshold || op.high_threshold) {
        events.push({
          id: `${baseId}-thresholds`,
          account_id: op.source_account,
          type: 'thresholds_updated',
          ledger_sequence: ledgerSequence,
          transaction_hash: op.transaction_hash,
          created_at: createdAt,
          previous_value: null,
          new_value: {
            low_threshold: op.low_threshold,
            med_threshold: op.med_threshold,
            high_threshold: op.high_threshold,
          },
          details: {
            low_threshold: op.low_threshold,
            med_threshold: op.med_threshold,
            high_threshold: op.high_threshold,
          },
        });
      }

      // Home domain changes
      if (op.home_domain !== undefined) {
        events.push({
          id: `${baseId}-home_domain`,
          account_id: op.source_account,
          type: 'home_domain_updated',
          ledger_sequence: ledgerSequence,
          transaction_hash: op.transaction_hash,
          created_at: createdAt,
          previous_value: null,
          new_value: { home_domain: op.home_domain },
          details: { home_domain: op.home_domain },
        });
      }

      // Inflation destination changes
      if (op.inflation_dest) {
        events.push({
          id: `${baseId}-inflation`,
          account_id: op.source_account,
          type: 'inflation_destination_updated',
          ledger_sequence: ledgerSequence,
          transaction_hash: op.transaction_hash,
          created_at: createdAt,
          previous_value: null,
          new_value: { inflation_dest: op.inflation_dest },
          details: { inflation_dest: op.inflation_dest },
        });
      }

      // Flags changes
      if (
        op.set_flags !== undefined ||
        op.clear_flags !== undefined
      ) {
        events.push({
          id: `${baseId}-flags`,
          account_id: op.source_account,
          type: 'flags_updated',
          ledger_sequence: ledgerSequence,
          transaction_hash: op.transaction_hash,
          created_at: createdAt,
          previous_value: null,
          new_value: {
            set_flags: op.set_flags,
            clear_flags: op.clear_flags,
          },
          details: {
            set_flags: op.set_flags,
            clear_flags: op.clear_flags,
          },
        });
      }
      break;
    }

    case 'change_trust': {
      const op = operation as Horizon.ServerApi.ChangeTrustOperationRecord;
      const isRemoval = op.limit === '0';
      const trustlineEventType: AccountEventType = isRemoval
        ? 'trustline_removed'
        : op.asset_code
          ? 'trustline_added'
          : 'trustline_updated';

      events.push({
        id: `${baseId}-trustline`,
        account_id: op.source_account,
        type: trustlineEventType,
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: {
          asset_type: op.asset_type,
          asset_code: op.asset_code,
          asset_issuer: op.asset_issuer,
          limit: op.limit,
          trustee: op.trustee,
          trustor: op.trustor,
        },
        details: {
          asset_type: op.asset_type,
          asset_code: op.asset_code,
          asset_issuer: op.asset_issuer,
          limit: op.limit,
        },
      });
      break;
    }

    case 'manage_data': {
      const op = operation as Horizon.ServerApi.ManageDataOperationRecord;
      const isRemoval = op.value === null;
      const dataEventType: AccountEventType = isRemoval
        ? 'data_removed'
        : 'data_added';

      events.push({
        id: `${baseId}-data`,
        account_id: op.source_account,
        type: dataEventType,
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { name: op.name, value: op.value },
        details: { name: op.name, value: op.value },
      });
      break;
    }

    case 'bump_sequence': {
      const op = operation as Horizon.ServerApi.BumpSequenceOperationRecord;
      events.push({
        id: `${baseId}-bump`,
        account_id: op.source_account,
        type: 'sequence_bumped',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { bump_to: op.bump_to },
        details: { bump_to: op.bump_to },
      });
      break;
    }

    case 'begin_sponsoring_future_reserves': {
      const op = operation as Horizon.ServerApi.BeginSponsoringFutureReservesOperationRecord;
      events.push({
        id: `${baseId}-sponsor-begin`,
        account_id: op.source_account,
        type: 'sponsorship_updated',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { sponsored_id: op.sponsored_id, action: 'begin_sponsoring' },
        details: { sponsored_id: op.sponsored_id },
      });
      break;
    }

    case 'end_sponsoring_future_reserves': {
      const op = operation as Horizon.ServerApi.EndSponsoringFutureReservesOperationRecord;
      events.push({
        id: `${baseId}-sponsor-end`,
        account_id: op.source_account,
        type: 'sponsorship_updated',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: { action: 'end_sponsoring' },
        details: {},
      });
      break;
    }

    case 'revoke_sponsorship': {
      const op = operation as Horizon.ServerApi.RevokeSponsorshipOperationRecord;
      events.push({
        id: `${baseId}-sponsor-revoke`,
        account_id: op.source_account,
        type: 'sponsorship_updated',
        ledger_sequence: ledgerSequence,
        transaction_hash: op.transaction_hash,
        created_at: createdAt,
        previous_value: null,
        new_value: {
          account_id: op.account_id,
          action: 'revoke_sponsorship',
        },
        details: {
          account_id: op.account_id,
          claimable_balance_id: op.claimable_balance_id,
          data_account_id: op.data_account_id,
          data_name: op.data_name,
        },
      });
      break;
    }

    default:
      // Non-account-affecting operation type; no events produced
      break;
  }

  return events;
}

/**
 * Extract account events from an array of operations.
 */
export function extractAccountEventsFromOperations(
  operations: Horizon.ServerApi.OperationRecord[],
  transactionHash: string,
  ledgerSequence: number,
): AccountEventRow[] {
  return operations.flatMap((op) => extractAccountEvents(op));
}
