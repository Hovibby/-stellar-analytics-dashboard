import { DatabaseConnection } from './connection';
import { runMigrations } from './migration-runner';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const db = DatabaseConnection.getInstance();

export async function setupIntegrationTestEnv(): Promise<void> {
  // Safety check to prevent running against production
  if (!process.env.DATABASE_URL?.includes('_test') && process.env.NODE_ENV === 'production') {
    throw new Error('Integration tests must run against a test database!');
  }

  // Run migrations to ensure schema is ready
  try {
    await runMigrations({ direction: 'up' });
  } catch (error) {
    console.error('Migration failed during test setup:', error);
    throw error;
  }
}

export async function cleanupDatabase(): Promise<void> {
  const tables = ['operations', 'transactions', 'ledgers', 'blocks'];
  try {
    // Truncate all tables and reset identities
    await db.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
  } catch (error) {
    console.error('Database cleanup failed:', error);
  }
}

export async function teardownIntegrationTestEnv(): Promise<void> {
  await db.disconnect();
}

export { db };
