import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

export const ledgers_processed_total = new Counter({
  name: 'ledgers_processed_total',
  help: 'Total number of ledgers processed',
  registers: [registry],
});

export const transactions_processed_total = new Counter({
  name: 'transactions_processed_total',
  help: 'Total number of transactions processed',
  registers: [registry],
});

export const operations_processed_total = new Counter({
  name: 'operations_processed_total',
  help: 'Total number of operations processed',
  registers: [registry],
});

export const ingestion_duration_seconds = new Histogram({
  name: 'ingestion_duration_seconds',
  help: 'Duration of the ingestion process in seconds',
  registers: [registry],
});
