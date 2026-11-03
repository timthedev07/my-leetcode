import type Database from 'better-sqlite3'

type SettingRow = {
  value: unknown
}

const CREDENTIAL_KEY_PATTERN =
  /token|password|secret|credential|cookie|session(?:[_-]?id)?/i

export class UnsafeSettingError extends Error {
  constructor() {
    super('Settings cannot contain tokens, passwords, cookies or other credentials.')
    this.name = 'UnsafeSettingError'
  }
}

export class CorruptSettingError extends Error {
  constructor(key: string) {
    super(`The stored value for setting "${key}" is invalid.`)
    this.name = 'CorruptSettingError'
  }
}

function normaliseSettingKey(key: string): string {
  const normalisedKey = key.trim()

  if (!normalisedKey) {
    throw new Error('A setting key is required.')
  }

  if (CREDENTIAL_KEY_PATTERN.test(normalisedKey)) {
    throw new UnsafeSettingError()
  }

  return normalisedKey
}

export function getSetting(
  database: Database.Database,
  key: string
): string | null {
  const normalisedKey = normaliseSettingKey(key)
  const row = database
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(normalisedKey) as SettingRow | undefined

  if (!row) {
    return null
  }

  if (typeof row.value !== 'string') {
    throw new CorruptSettingError(normalisedKey)
  }

  return row.value
}

export function setSetting(
  database: Database.Database,
  key: string,
  value: string
): void {
  const normalisedKey = normaliseSettingKey(key)

  database
    .prepare(
      `
        INSERT INTO settings (key, value, updated_at_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .run(normalisedKey, value, Date.now())
}
