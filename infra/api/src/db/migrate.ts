import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Pool, PoolClient } from 'pg'

const MIGRATIONS_TABLE = 'schema_migrations'
const DEFAULT_MIGRATIONS_DIR = new URL('../../migrations', import.meta.url)

async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  )
}

async function loadAppliedMigrations(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ name: string }>(
    `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name`
  )
  return new Set(result.rows.map((row) => row.name))
}

export class MigrationError extends Error {
  constructor(readonly file: string, cause: unknown) {
    super(`Не удалось применить миграцию ${file}`, {
      cause: cause instanceof Error ? cause : undefined
    })
    this.name = 'MigrationError'
  }
}

async function applyMigration(client: PoolClient, file: string, sql: string): Promise<void> {
  await client.query('BEGIN')
  try {
    await client.query(sql)
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1)`, [file])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw new MigrationError(file, error)
  }
}

export type RunMigrationsOptions = {
  migrationsDir?: URL
  logger?: (message: string) => void
}

export async function runMigrations(pool: Pool, options: RunMigrationsOptions = {}): Promise<void> {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR
  const logger = options.logger ?? ((message: string) => console.log(`[migrate] ${message}`))

  const directory = fileURLToPath(migrationsDir)
  let directoryFiles: string[]
  try {
    directoryFiles = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger(`Каталог миграций отсутствует (${directory}) — пропускаю`)
      return
    }
    throw error
  }

  const files = directoryFiles.filter((file) => file.endsWith('.sql')).sort((a, b) => a.localeCompare(b))

  if (files.length === 0) {
    logger('Нет SQL-файлов миграций — пропускаю')
    return
  }

  const client = await pool.connect()
  try {
    await ensureMigrationsTable(client)
    const applied = await loadAppliedMigrations(client)

    for (const file of files) {
      if (applied.has(file)) {
        logger(`Пропускаю уже применённую миграцию ${file}`)
        continue
      }

      const absolutePath = join(directory, file)
      const sql = await readFile(absolutePath, 'utf8')
      logger(`Применяю ${file}`)
      await applyMigration(client, file, sql)
      logger(`✅ ${file}`)
    }

    logger('Все миграции применены')
  } finally {
    client.release()
  }
}
