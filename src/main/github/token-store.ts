import { randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { safeStorage } from 'electron'
import { AppError } from '../security/app-error'

type AsyncDecryptResult = {
  result: string
  shouldReEncrypt: boolean
}

export type SafeStorageAdapter = {
  isAsyncEncryptionAvailable?: () => Promise<boolean>
  isEncryptionAvailable?: () => boolean
  encryptStringAsync?: (plainText: string) => Promise<Buffer>
  encryptString?: (plainText: string) => Buffer
  decryptStringAsync?: (encrypted: Buffer) => Promise<AsyncDecryptResult>
  decryptString?: (encrypted: Buffer) => string
}

const electronSafeStorage = safeStorage as SafeStorageAdapter | undefined

export type GitHubCredential = {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAtMs?: number
  refreshTokenExpiresAtMs?: number
}

export class TokenStore {
  private pendingOperation: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly storage: SafeStorageAdapter | undefined = electronSafeStorage
  ) {}

  readToken(): Promise<string | null> {
    return this.readCredential().then((credential) => credential?.accessToken ?? null)
  }

  readCredential(): Promise<GitHubCredential | null> {
    return this.enqueue(async () => {
      await this.assertEncryptionAvailable()

      let encrypted: Buffer
      try {
        encrypted = await readFile(this.filePath)
      } catch (error) {
        if (isMissingFile(error)) return null
        throw storageError('GitHub credentials could not be read securely.', error)
      }

      try {
        return parseCredential(await this.decrypt(encrypted))
      } catch (error) {
        throw storageError('GitHub credentials could not be decrypted. Reconnect GitHub.', error)
      }
    })
  }

  saveToken(token: string): Promise<void> {
    return this.saveCredential({ accessToken: token })
  }

  saveCredential(credential: GitHubCredential): Promise<void> {
    return this.enqueue(async () => {
      const normalised = normaliseCredential(credential)
      if (!normalised) {
        throw new AppError('STORAGE_FAILED', 'GitHub returned an empty access token. Reconnect GitHub.')
      }

      await this.assertEncryptionAvailable()

      let encrypted: Buffer
      try {
        encrypted = await this.encrypt(JSON.stringify(normalised))
      } catch (error) {
        throw storageError('GitHub credentials could not be encrypted.', error)
      }

      const directory = dirname(this.filePath)
      const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`

      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const handle = await open(temporaryPath, 'wx', 0o600)
        try {
          await handle.writeFile(encrypted)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await chmod(temporaryPath, 0o600)
        await rename(temporaryPath, this.filePath)
        await chmod(this.filePath, 0o600)
      } catch (error) {
        await removeIfPresent(temporaryPath)
        throw storageError('GitHub credentials could not be saved securely.', error)
      }
    })
  }

  clearToken(): Promise<void> {
    return this.clearCredential()
  }

  clearCredential(): Promise<void> {
    return this.enqueue(async () => {
      try {
        await unlink(this.filePath)
      } catch (error) {
        if (!isMissingFile(error)) {
          throw storageError('GitHub credentials could not be removed.', error)
        }
      }
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pendingOperation.then(operation, operation)
    this.pendingOperation = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  private async assertEncryptionAvailable(): Promise<void> {
    if (!this.storage) {
      throw unavailableError()
    }

    try {
      if (this.storage.isAsyncEncryptionAvailable) {
        if (!(await this.storage.isAsyncEncryptionAvailable())) {
          throw unavailableError()
        }
        return
      }

      if (this.storage.isEncryptionAvailable?.()) return
    } catch (error) {
      if (error instanceof AppError) throw error
      throw storageError('Secure credential storage is unavailable.', error)
    }

    throw unavailableError()
  }

  private async encrypt(plainText: string): Promise<Buffer> {
    if (this.storage?.encryptStringAsync) {
      return this.storage.encryptStringAsync(plainText)
    }
    if (this.storage?.encryptString) {
      return this.storage.encryptString(plainText)
    }
    throw unavailableError()
  }

  private async decrypt(encrypted: Buffer): Promise<string> {
    if (this.storage?.decryptStringAsync) {
      return (await this.storage.decryptStringAsync(encrypted)).result
    }
    if (this.storage?.decryptString) {
      return this.storage.decryptString(encrypted)
    }
    throw unavailableError()
  }
}

function parseCredential(value: string): GitHubCredential {
  if (value.length === 0) {
    throw new Error('The decrypted credential is empty.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    // Credentials written by older versions were plain access-token strings.
    return { accessToken: value }
  }
  if (typeof parsed !== 'object' || parsed === null || !('accessToken' in parsed)) {
    throw new Error('The decrypted credential has an unsupported format.')
  }
  const normalised = normaliseCredential(parsed as GitHubCredential)
  if (!normalised) throw new Error('The decrypted credential has an empty access token.')
  return normalised
}

function normaliseCredential(
  credential: GitHubCredential
): GitHubCredential | null {
  const accessToken = credential.accessToken
  if (!accessToken) return null
  const result: GitHubCredential = { accessToken }
  if (credential.refreshToken) {
    result.refreshToken = credential.refreshToken
  }
  if (
    credential.accessTokenExpiresAtMs !== undefined &&
    Number.isFinite(credential.accessTokenExpiresAtMs)
  ) {
    result.accessTokenExpiresAtMs = credential.accessTokenExpiresAtMs
  }
  if (
    credential.refreshTokenExpiresAtMs !== undefined &&
    Number.isFinite(credential.refreshTokenExpiresAtMs)
  ) {
    result.refreshTokenExpiresAtMs = credential.refreshTokenExpiresAtMs
  }
  return result
}

function unavailableError(): AppError {
  return new AppError(
    'STORAGE_FAILED',
    'Secure credential storage is unavailable. Unlock your system keychain and restart the app.'
  )
}

function storageError(message: string, error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('STORAGE_FAILED', message, error instanceof Error ? error.message : undefined)
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function removeIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isMissingFile(error)) {
      // The original write error is more useful than a temporary-file cleanup failure.
    }
  }
}
