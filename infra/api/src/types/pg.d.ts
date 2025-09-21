// Минимальные определения типов для pg, позволяющие собирать проект офлайн.
// При установке реального пакета pg типы будут расширены автоматически.
declare module 'pg' {
  export interface QueryResultRow {
    [column: string]: unknown
  }

  export interface QueryResult<T extends QueryResultRow = QueryResultRow> {
    rows: T[]
  }

  export interface PoolClient {
    query<T extends QueryResultRow = QueryResultRow>(
      queryText: string,
      values?: unknown[]
    ): Promise<QueryResult<T>>
    release(): void
  }

  export interface PoolConfig {
    connectionString?: string
  }

  export class Pool {
    constructor(config?: PoolConfig)
    connect(): Promise<PoolClient>
    end(): Promise<void>
  }
}
