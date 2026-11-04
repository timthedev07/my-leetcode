import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GitHubAuthService,
  type FetchTransport,
  type GitHubTokenStore
} from '../../src/main/github/auth'
import {
  TokenStore,
  type GitHubCredential,
  type SafeStorageAdapter
} from '../../src/main/github/token-store'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function createTokenStore(): GitHubTokenStore & {
  readCredential: ReturnType<typeof vi.fn>
  saveCredential: ReturnType<typeof vi.fn>
  clearCredential: ReturnType<typeof vi.fn>
} {
  let credential: GitHubCredential | null = null
  return {
    readCredential: vi.fn(async () => credential),
    saveCredential: vi.fn(async (nextCredential: GitHubCredential) => {
      credential = nextCredential
    }),
    clearCredential: vi.fn(async () => {
      credential = null
    })
  }
}

function createEncryptedAdapter(
  available = true
): SafeStorageAdapter & {
  encryptStringAsync: ReturnType<typeof vi.fn>
  decryptStringAsync: ReturnType<typeof vi.fn>
} {
  return {
    isAsyncEncryptionAvailable: vi.fn(async () => available),
    encryptStringAsync: vi.fn(async (plainText: string) =>
      Buffer.from(Array.from(plainText).reverse().join(''))
    ),
    decryptStringAsync: vi.fn(async (encrypted: Buffer) => ({
      result: Array.from(encrypted.toString()).reverse().join(''),
      shouldReEncrypt: false
    }))
  }
}

describe('GitHub device authorisation', () => {
  it('starts the official device flow with the required public-client scope', async () => {
    const transport = vi.fn<FetchTransport>().mockResolvedValueOnce(
      jsonResponse({
        device_code: 'device-code',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5
      })
    )
    const service = new GitHubAuthService(transport, () => 'client-id', createTokenStore())

    const authorisation = await service.beginDeviceAuthorisation()

    expect(authorisation).toEqual({
      deviceCode: 'device-code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresInSeconds: 900,
      intervalSeconds: 5
    })
    expect(transport).toHaveBeenCalledOnce()
    expect(transport.mock.calls[0]?.[0]).toBe('https://github.com/login/device/code')

    const init = transport.mock.calls[0]?.[1]
    expect(new Headers(init?.headers).get('Accept')).toBe('application/json')
    expect(init?.body).toBeInstanceOf(URLSearchParams)
    const body = init?.body as URLSearchParams
    expect(body.get('client_id')).toBe('client-id')
    expect(body.get('scope')).toBe('repo read:user')
  })

  it('polls from pending to confirmed token and validates the GitHub user', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: 'device-code',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'opaque-token', token_type: 'bearer' }))
      .mockResolvedValueOnce(
        jsonResponse({ login: 'timthedev07', avatar_url: 'https://avatars.githubusercontent.com/u/1' })
      )
    const tokens = createTokenStore()
    const delay = vi.fn<(seconds: number) => Promise<void>>(async () => undefined)
    const service = new GitHubAuthService(transport, async () => 'client-id', tokens, delay)
    const authorisation = await service.beginDeviceAuthorisation()

    const status = await service.pollDeviceAuthorisation(
      authorisation.deviceCode,
      authorisation.intervalSeconds,
      authorisation.expiresInSeconds
    )

    expect(tokens.saveCredential).toHaveBeenCalledOnce()
    expect(tokens.saveCredential).toHaveBeenCalledWith({ accessToken: 'opaque-token' })
    expect(status).toEqual({
      state: 'connected',
      username: 'timthedev07',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1'
    })
    expect(delay.mock.calls.map(([seconds]) => seconds)).toEqual([5, 10])
    const tokenRequest = transport.mock.calls[3]?.[1]?.body as URLSearchParams
    expect(tokenRequest.get('device_code')).toBe('device-code')
    expect(tokenRequest.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code')
  })

  it('does not store a token when authorisation is denied', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse({ error: 'access_denied' }))
    const tokens = createTokenStore()
    const service = new GitHubAuthService(transport, () => 'client-id', tokens)

    await expect(service.pollDeviceAuthorisation('device-code', 0, 900)).rejects.toMatchObject({
      code: 'ACCESS_DENIED'
    })
    expect(tokens.saveCredential).not.toHaveBeenCalled()
  })

  it('reports an expired device code without storing a token', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired_token' }))
    const tokens = createTokenStore()
    const service = new GitHubAuthService(transport, () => 'client-id', tokens)

    await expect(service.pollDeviceAuthorisation('device-code', 0, 900)).rejects.toMatchObject({
      code: 'AUTH_EXPIRED'
    })
    expect(tokens.saveCredential).not.toHaveBeenCalled()
  })

  it('can be cancelled before polling starts', async () => {
    const transport = vi.fn<FetchTransport>()
    const service = new GitHubAuthService(transport, () => 'client-id', createTokenStore())
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.pollDeviceAuthorisation('device-code', 1, 900, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(transport).not.toHaveBeenCalled()
  })

  it('refreshes and rotates expiring credentials without exposing them to callers', async () => {
    const transport = vi.fn<FetchTransport>().mockResolvedValueOnce(
      jsonResponse({
        access_token: 'refreshed-access-token',
        expires_in: 900,
        refresh_token: 'refreshed-refresh-token',
        refresh_token_expires_in: 15_000
      })
    )
    const tokens = createTokenStore()
    await tokens.saveCredential({
      accessToken: 'expired-access-token',
      refreshToken: 'old-refresh-token',
      accessTokenExpiresAtMs: Date.now() - 1,
      refreshTokenExpiresAtMs: Date.now() + 60_000
    })
    const service = new GitHubAuthService(transport, () => 'client-id', tokens)

    await expect(service.getAccessToken()).resolves.toBe('refreshed-access-token')

    const request = transport.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(request.get('grant_type')).toBe('refresh_token')
    expect(request.get('refresh_token')).toBe('old-refresh-token')
    expect(tokens.saveCredential).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accessToken: 'refreshed-access-token',
        refreshToken: 'refreshed-refresh-token'
      })
    )
  })

  it('clears unusable refresh credentials and requests reauthorisation', async () => {
    const transport = vi
      .fn<FetchTransport>()
      .mockResolvedValueOnce(jsonResponse({ error: 'bad_refresh_token' }))
    const tokens = createTokenStore()
    await tokens.saveCredential({
      accessToken: 'expired-access-token',
      refreshToken: 'bad-refresh-token',
      accessTokenExpiresAtMs: Date.now() - 1
    })
    const service = new GitHubAuthService(transport, () => 'client-id', tokens)

    await expect(service.getAccessToken()).rejects.toMatchObject({ code: 'AUTH_EXPIRED' })
    expect(tokens.clearCredential).toHaveBeenCalled()
  })
})

describe('GitHub token storage', () => {
  it('round-trips only encrypted token bytes with 0600 permissions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leetcode-desktop-github-'))
    temporaryDirectories.push(directory)
    const tokenPath = join(directory, 'github-token.bin')
    const adapter = createEncryptedAdapter()
    const store = new TokenStore(tokenPath, adapter)

    expect(await store.readToken()).toBeNull()
    await store.saveToken('opaque-token-value')

    const encryptedBytes = await readFile(tokenPath)
    expect(encryptedBytes.toString()).not.toContain('opaque-token-value')
    expect((await stat(tokenPath)).mode & 0o777).toBe(0o600)

    const restoredStore = new TokenStore(tokenPath, adapter)
    expect(await restoredStore.readToken()).toBe('opaque-token-value')

    await store.clearToken()
    expect(await store.readToken()).toBeNull()
  })

  it('fails with actionable guidance when safe storage is unavailable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leetcode-desktop-github-'))
    temporaryDirectories.push(directory)
    const store = new TokenStore(join(directory, 'github-token.bin'), createEncryptedAdapter(false))

    await expect(store.saveToken('opaque-token-value')).rejects.toEqual(
      expect.objectContaining({
        code: 'STORAGE_FAILED',
        message:
          'Secure credential storage is unavailable. Unlock your system keychain and restart the app.'
      })
    )
  })

  it('round-trips refresh credentials without writing plaintext', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'leetcode-desktop-github-'))
    temporaryDirectories.push(directory)
    const tokenPath = join(directory, 'github-token.bin')
    const store = new TokenStore(tokenPath, createEncryptedAdapter())
    const credential: GitHubCredential = {
      accessToken: 'access-value',
      refreshToken: 'refresh-value',
      accessTokenExpiresAtMs: 2_000_000,
      refreshTokenExpiresAtMs: 3_000_000
    }

    await store.saveCredential(credential)

    expect(await store.readCredential()).toEqual(credential)
    const encryptedBytes = await readFile(tokenPath)
    expect(encryptedBytes.toString()).not.toContain('access-value')
    expect(encryptedBytes.toString()).not.toContain('refresh-value')
  })
})
