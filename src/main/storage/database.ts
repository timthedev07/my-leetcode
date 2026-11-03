import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'

export type AppDatabase = Database.Database

type Migration = {
  version: number
  up: (database: AppDatabase) => void
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    up: (database) => {
      database.exec(`
        CREATE TABLE attempts (
          account_key TEXT NOT NULL CHECK (length(trim(account_key)) > 0),
          problem_id TEXT NOT NULL
            CHECK (problem_id <> '' AND problem_id NOT GLOB '*[^0-9]*'),
          internal_problem_id TEXT NOT NULL
            CHECK (internal_problem_id <> '' AND internal_problem_id NOT GLOB '*[^0-9]*'),
          title_slug TEXT NOT NULL CHECK (length(trim(title_slug)) > 0),
          title TEXT NOT NULL CHECK (length(trim(title)) > 0),
          difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
          draft_cpp TEXT NOT NULL,
          editor_state_json TEXT,
          created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
          last_activity_at_ms INTEGER NOT NULL CHECK (last_activity_at_ms >= 0),
          last_saved_at_ms INTEGER NOT NULL CHECK (last_saved_at_ms >= 0),
          PRIMARY KEY (account_key, problem_id)
        );

        CREATE INDEX attempts_recent_idx
          ON attempts (account_key, last_activity_at_ms DESC);

        CREATE TABLE settings (
          key TEXT NOT NULL PRIMARY KEY CHECK (length(trim(key)) > 0),
          value TEXT NOT NULL,
          updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0)
        );
      `)
    }
  }
]

function schemaVersion(database: AppDatabase): number {
  return Number(database.pragma('user_version', { simple: true }))
}

export function migrateDatabase(database: AppDatabase): void {
  const currentVersion = schemaVersion(database)
  const latestVersion = migrations.at(-1)?.version ?? 0

  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error('The database schema version is invalid.')
  }

  if (currentVersion > latestVersion) {
    throw new Error(
      `The database schema version ${currentVersion} is newer than this application supports.`
    )
  }

  for (const migration of migrations) {
    if (migration.version <= currentVersion) {
      continue
    }

    const applyMigration = database.transaction(() => {
      migration.up(database)
      database.pragma(`user_version = ${migration.version}`)
    })

    applyMigration()
  }
}

export function openDatabase(databasePath: string): AppDatabase {
  if (!databasePath.trim()) {
    throw new Error('A database path is required.')
  }

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true })
  }

  const database = new Database(databasePath)

  try {
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma('synchronous = NORMAL')
    database.pragma('busy_timeout = 5000')
    migrateDatabase(database)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
