import pg from "pg";
import { pubsub } from "./pubsub.js";

const { Client } = pg;

/**
 * Dedicated (non-pooled) Postgres connection that LISTENs for
 * `ledger_events` notifications emitted by the indexer after each
 * committed ledger write (see indexer/src/loader.ts), and republishes
 * them on the in-process PubSub for GraphQL subscriptions (Issue #210).
 *
 * A separate connection is required because LISTEN/NOTIFY is
 * connection-scoped — it can't share the query pool used for request
 * handling.
 */
export async function startLedgerEventListener(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();
  await client.query("LISTEN ledger_events");

  client.on("notification", (msg) => {
    if (msg.channel !== "ledger_events" || !msg.payload) return;
    try {
      const payload = JSON.parse(msg.payload);
      pubsub.publish("LEDGER_ADDED", payload);
    } catch (err) {
      console.warn("[api] failed to parse ledger_events payload", err);
    }
  });

  client.on("error", (err) => {
    console.error("[api] ledger event listener connection error", err);
  });

  console.log("[api] listening for ledger_events notifications");
  return client;
}
