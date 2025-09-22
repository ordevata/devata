import { Pool, type PoolClient } from 'pg'

let pool: Pool | null = null

function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (url && url.trim().length > 0) {
    return url
  }
  return 'postgresql://devata:devata@localhost:5432/devata'
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: resolveDatabaseUrl() })
  }
  return pool
}

export async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const result = await handler(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch (rollbackError) {
      console.error('[db] Ошибка отката транзакции', rollbackError)
    }
    throw error
  } finally {
    client.release()
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export type { PoolClient } from 'pg'
