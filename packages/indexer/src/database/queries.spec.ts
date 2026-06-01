/* eslint-disable @typescript-eslint/no-explicit-any */

import { ApolloServer } from '@apollo/server';
import { typeDefs } from '../../schema';
import { resolvers } from '../../resolvers';
import {
  setupIntegrationTestEnv,
  cleanupDatabase,
  teardownIntegrationTestEnv,
  db,
} from './integration-setup';

describe('GraphQL API: Queries Integration', () => {
  let testServer: ApolloServer;

  beforeAll(async () => {
    await setupIntegrationTestEnv();
    testServer = new ApolloServer({
      typeDefs,
      resolvers,
    });
  });

  afterAll(async () => {
    await teardownIntegrationTestEnv();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  describe('ledgers query', () => {
    it('should return a list of ledgers from the database', async () => {
      // Seed test data
      await db.query(`
        INSERT INTO ledgers (sequence, ledger_hash, total_coins, closed_at)
        VALUES 
          (100, 'hash_100', '1000000', NOW()),
          (101, 'hash_101', '1000000', NOW())
      `);

      const GET_LEDGERS = `
        query GetLedgers($limit: Int) {
          ledgers(limit: $limit) {
            sequence
            ledger_hash
          }
        }
      `;

      const response = await testServer.executeOperation({
        query: GET_LEDGERS,
        variables: { limit: 10 },
      });

      if (response.body.kind !== 'single') {
        throw new Error('Expected single result from Apollo');
      }
      const result = response.body.singleResult;
      expect(result.errors).toBeUndefined();
      expect(result.data.ledgers).toHaveLength(2);
      expect(result.data.ledgers[0].sequence).toBe(101); // Assuming desc sort
    });

    it('should return empty array when no ledgers exist', async () => {
      const response = await testServer.executeOperation({
        query: '{ ledgers { sequence } }',
      });

      if (response.body.kind !== 'single') {
        throw new Error('Expected single result from Apollo');
      }
      const result = response.body.singleResult;
      expect(result.data.ledgers).toEqual([]);
    });
  });

  describe('transactions query', () => {
    it('should fetch transactions linked to a specific ledger', async () => {
      // Seed a ledger and a linked transaction
      await db.query(`
        INSERT INTO ledgers (sequence, ledger_hash, total_coins, closed_at)
        VALUES (200, 'hash_200', '2000000', NOW())
      `);
      await db.query(`
        INSERT INTO transactions (id, ledger_sequence, source_account, fee_charged, successful, created_at)
        VALUES ('tx_test_123', 200, 'GA5WUM...', '100', true, NOW())
      `);

      const GET_TRANSACTIONS = `
        query GetTransactions($ledgerSequence: Int) {
          transactions(ledgerSequence: $ledgerSequence) {
            id
            source_account
            successful
          }
        }
      `;

      const response = await testServer.executeOperation({
        query: GET_TRANSACTIONS,
        variables: { ledgerSequence: 200 },
      });

      if (response.body.kind !== 'single') {
        throw new Error('Expected single result from Apollo');
      }
      const result = response.body.singleResult;
      expect(result.errors).toBeUndefined();
      expect(result.data.transactions).toHaveLength(1);
      expect(result.data.transactions[0].id).toBe('tx_test_123');
    });
  });

  describe('mutations', () => {
    it('should be able to execute a mutation', async () => {
      // Example placeholder for mutations like updating user preferences
      // This ensures the mutation resolver logic is also covered by integration tests
      const TEST_MUTATION = `
        mutation TestMutation {
          ping
        }
      `;

      const response = await testServer.executeOperation({ query: TEST_MUTATION });
      if (response.body.kind !== 'single') {
        throw new Error('Expected single result from Apollo');
      }
      const result = response.body.singleResult;
      expect(result.errors).toBeUndefined();
    });
  });
});
