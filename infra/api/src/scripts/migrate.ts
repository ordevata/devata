import { closePool, getPool } from '../db/pool.js'
import { runMigrations } from '../db/migrate.js'

async function main(): Promise<void> {
  const pool = getPool()
  await runMigrations(pool)
  await closePool()
}

main().catch((error) => {
  console.error('[migrate] Ошибка выполнения миграций:', error)
  process.exit(1)
})
