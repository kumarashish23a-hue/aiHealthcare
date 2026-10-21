import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const isSqlConfigured = Boolean(
  process.env.SQL_HOST && process.env.SQL_DB_NAME
);

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST || '127.0.0.1',
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 5432,
      user: process.env.SQL_USER || 'postgres',
      password: process.env.SQL_PASSWORD || '',
      database: process.env.SQL_DB_NAME || 'swasthyasetu',
      max: 10,
      connectionTimeoutMillis: 3000,
    });

    global._postgresPool.on('error', (err) => {
      if (!isSqlConfigured) return;
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });

/**
 * Production guard (Phase 2): in production the in-memory/synthetic
 * store must NEVER serve data. Pure helper (env passed in) so it is
 * unit-testable; call assertProductionPersistence() from API routes.
 */
export function getPersistenceMode(env: {
  nodeEnv?: string;
  sqlConfigured: boolean;
}): 'postgres' | 'in_memory_dev_only' {
  return env.sqlConfigured ? 'postgres' : 'in_memory_dev_only';
}

export function assertProductionPersistence(env?: {
  nodeEnv?: string;
  sqlConfigured: boolean;
}): void {
  const nodeEnv = env?.nodeEnv ?? process.env.NODE_ENV;
  const sqlConfigured = env?.sqlConfigured ?? isSqlConfigured;
  if (nodeEnv === 'production' && !sqlConfigured) {
    throw new Error(
      'ConfigurationError: SQL persistence is not configured (SQL_HOST/SQL_DB_NAME missing). ' +
        'Production refuses to run on the in-memory store. Set the SQL_* env vars (see .env.example).'
    );
  }
}
