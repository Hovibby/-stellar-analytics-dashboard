import pg from "pg";
import { pubsub } from "./pubsub.js";

const { Client } = pg;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

interface LedgerEventPayload {
  // Adjust to match the indexer's actual NOTIFY payload shape.
  [key: string]: unknown;
}

export interface LedgerEventListenerHandle {
  /** Gracefully stop listening and close the connection. */
  stop: () => Promise<void>;
}

/**
 * Dedicated (non-pooled) Postgres connection that LISTENs for
 * `ledger_events` notifications emitted by the indexer after each
 * committed ledger write (see indexer/src/loader.ts), and republishes
 * them on the in-process PubSub for GraphQL subscriptions (Issue #210).
 *
 * A separate connection is required because LISTEN/NOTIFY is
 * connection-scoped — it can't share the query pool used for request
 * handling.
 *
 * If the connection drops (network blip, server restart, etc.), this
 * automatically reconnects with exponential backoff rather than
 * silently going dark.
 */
export function startLedgerEventListener(
  connectionString: string
): LedgerEventListenerHandle {
  let client: pg.Client | null = null;
  let stopped = false;
  let reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const log = {
    info: (msg: string) => console.log(`[api] ${msg}`),
    warn: (msg: string, err?: unknown) => console.warn(`[api] ${msg}`, err ?? ""),
    error: (msg: string, err?: unknown) => console.error(`[api] ${msg}`, err ?? ""),
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
      RECONNECT_MAX_DELAY_MS
    );
    reconnectAttempt += 1;
    log.warn(`ledger event listener reconnecting in ${delay}ms`);
    reconnectTimer = setTimeout(() => {
      connect().catch((err) => {
        log.error("ledger event listener reconnect failed", err);
        scheduleReconnect();
      });
    }, delay);
  };

  const connect = async () => {
    const newClient = new Client({ connectionString });

    // Postgres emits 'error' on unexpected connection issues; without
    // a handler here, that would crash the process (unhandled 'error'
    // event on an EventEmitter).
    newClient.on("error", (err) => {
      log.error("ledger event listener connection error", err);
    });

    newClient.on("end", () => {
      if (stopped) return;
      log.warn("ledger event listener connection ended unexpectedly");
      scheduleReconnect();
    });

    newClient.on("notification", (msg) => {
      if (msg.channel !== "ledger_events" || !msg.payload) return;
      try {
        const payload = JSON.parse(msg.payload) as LedgerEventPayload;
        pubsub.publish("LEDGER_ADDED", payload);
      } catch (err) {
        log.warn("failed to parse ledger_events payload", err);
      }
    });

    await newClient.connect();
    await newClient.query("LISTEN ledger_events");

    client = newClient;
    reconnectAttempt = 0; // reset backoff after a successful connect
    log.info("listening for ledger_events notifications");
  };

  // Kick off the initial connection. Failures here also trigger
  // reconnect rather than throwing out of a fire-and-forget call.
  connect().catch((err) => {
    log.error("ledger event listener initial connection failed", err);
    scheduleReconnect();
  });

  return {
    stop: async () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (client) {
        try {
          await client.query("UNLISTEN ledger_events");
        } catch {
          // connection may already be dead; ignore
        }
        await client.end().catch(() => {});
        client = null;
      }
      log.info("ledger event listener stopped");
    },
  };
}