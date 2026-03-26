import { Pool, PoolClient, QueryResult } from 'pg';
import { logger } from '../utils/logger';

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'jpmt_tracking',
  user: process.env.DB_USER || 'jpmt_user',
  password: process.env.DB_PASSWORD || 'jpmt_password',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: parseInt(process.env.DB_POOL_SIZE || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  application_name: 'jpmt_tracking_server',
};

// Create connection pool
export const pool = new Pool(dbConfig);

// Connection event handlers
pool.on('connect', () => {
  logger.debug('New database connection established');
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
});

pool.on('acquire', () => {
  logger.debug('Client acquired from pool');
});

pool.on('remove', () => {
  logger.debug('Client removed from pool');
});

/**
 * Execute a query with automatic client management
 */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    
    logger.debug('Database query executed', {
      duration,
      rows: result.rowCount,
      query: text.substring(0, 100),
    });
    
    return result;
  } catch (error) {
    logger.error('Database query error', {
      error: (error as Error).message,
      query: text.substring(0, 200),
      params,
    });
    throw error;
  }
}

/**
 * Get a client from the pool for transactions
 */
export async function getClient(): Promise<PoolClient> {
  return await pool.connect();
}

/**
 * Execute a transaction with automatic rollback on error
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database health
 */
export async function checkHealth(): Promise<{
  healthy: boolean;
  latency: number;
  connections: number;
}> {
  const start = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      healthy: true,
      latency: Date.now() - start,
      connections: pool.totalCount,
    };
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - start,
      connections: pool.totalCount,
    };
  }
}

/**
 * Close all pool connections
 */
export async function closePool(): Promise<void> {
  logger.info('Closing database pool');
  await pool.end();
}

/**
 * Initialize database (run migrations)
 */
export async function initializeDatabase(): Promise<void> {
  try {
    const result = await query('SELECT NOW() as current_time');
    logger.info('Database connected', { 
      time: result.rows[0].current_time,
      poolSize: dbConfig.max,
    });
  } catch (error) {
    logger.error('Failed to connect to database', { error: (error as Error).message });
    throw error;
  }
}

export default pool;
