/**
 * useLedgerAddedSubscription (Issue #210)
 *
 * Subscribes to the `ledgerAdded` GraphQL subscription (pushed over
 * WebSocket, backed by Postgres LISTEN/NOTIFY on the API — see
 * api/src/pg-listener.ts) and invokes `onLedgerAdded` each time a new
 * ledger is committed by the indexer.
 *
 * Intentionally lightweight: rather than hand-splicing the pushed event
 * into Apollo's cache (the ledger/transaction list queries and the
 * subscription payload don't share an identical shape today), callers
 * typically pass a `refetch` from their own `useQuery` so a live push
 * triggers an instant refresh instead of waiting for the next poll tick.
 */
import { useSubscription } from "@apollo/client";
import { LEDGER_ADDED_SUBSCRIPTION } from "../graphql/queries";

export interface LedgerAddedEvent {
  sequence: number;
  transactionCount: number;
  closeTime: string;
}

export function useLedgerAddedSubscription(
  onLedgerAdded: (event: LedgerAddedEvent) => void
) {
  return useSubscription<{ ledgerAdded: LedgerAddedEvent }>(
    LEDGER_ADDED_SUBSCRIPTION,
    {
      onData: ({ data }) => {
        const event = data.data?.ledgerAdded;
        if (event) onLedgerAdded(event);
      },
    }
  );
}
