import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { AppError } from '../security/app-error'

export type GitHubCredential = {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAtMs?: number
  refreshTokenExpiresAtMs?: number
}

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16
const MAGIC = Buffer.from('LKD1')
const HEADER_BYTES = MAGIC.length + IV_BYTES + AUTH_TAG_BYTES

export class TokenStore {
  private pendingOperation: Promise<void> = Promise.resolve()
  private readonly keyPath: string

  constructor(private readonly filePath: string) {
    this.keyPath = `${filePath}.key`
  }

  readToken(): Promise<string | null> {
    return this.readCredential().then((credential) => credential?.accessToken ?? null)
  }

  readCredential(): Promise<GitHubCredential | null> {
    return this.enqueue(async () => {
      const encrypted = await readOptional(this.filePath)
      if (!encrypted) return null

      const key = await readOptional(this.keyPath)
      if (!key || key.length !== KEY_BYTES) {
        await this.clearStoredFiles()
        return null
      }

      try {
        return parseCredential(decryptCredential(encrypted, key))
      } catch {
        await this.clearStoredFiles()
        return null
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

      const key = await this.getOrCreateKey()
      const encrypted = encryptCredential(JSON.stringify(normalised), key)

      try {
        await writePrivateFile(this.filePath, encrypted)
      } catch (error) {
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
        await this.clearStoredFiles()
      } catch (error) {
        throw storageError('GitHub credentials could not be removed.', error)
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

  private async getOrCreateKey(): Promise<Buffer> {
    const existing = await readOptional(this.keyPath)
    if (existing?.length === KEY_BYTES) return existing
    if (existing) await removeOptional(this.keyPath)

    const key = randomBytes(KEY_BYTES)
    try {
      await writePrivateFile(this.keyPath, key)
      return key
    } catch (error) {
      throw storageError('GitHub credential encryption key could not be created.', error)
    }
  }

  private async clearStoredFiles(): Promise<void> {
    await removeOptional(this.filePath)
    await removeOptional(this.keyPath)
  }
}

function encryptCredential(plainText: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES })
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext])
}

function decryptCredential(encrypted: Buffer, key: Buffer): string {
  if (encrypted.length <= HEADER_BYTES || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('The encrypted credential has an unsupported format.')
  }

  const ivStart = MAGIC.length
  const authTagStart = ivStart + IV_BYTES
  const ciphertextStart = authTagStart + AUTH_TAG_BYTES
  const iv = encrypted.subarray(ivStart, authTagStart)
  const authTag = encrypted.subarray(authTagStart, ciphertextStart)
  const ciphertext = encrypted.subarray(ciphertextStart)
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES })
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function parseCredential(value: string): GitHubCredential {
  if (value.length === 0) {
    throw new Error('The decrypted credential is empty.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
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

async function writePrivateFile(filePath: string, contents: Buffer): Promise<void> {
  const directory = dirname(filePath)
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const handle = await open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await chmod(temporaryPath, 0o600)
    await rename(temporaryPath, filePath)
    await chmod(filePath, 0o600)
  } catch (error) {
    await removeOptional(temporaryPath)
    throw error
  }
}

async function readOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch (error) {
    if (isMissingFile(error)) return null
    throw storageError('Stored GitHub credential data could not be read.', error)
  }
}

async function removeOptional(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

function storageError(message: string, error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError('STORAGE_FAILED', message, error instanceof Error ? error.message : undefined)
}
