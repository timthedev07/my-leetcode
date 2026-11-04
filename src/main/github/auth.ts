import { GITHUB_ACCESS_TOKEN_URL, GITHUB_API_URL, GITHUB_DEVICE_CODE_URL } from '@shared/constants'
import type { GitHubAuthStatus, GitHubDeviceAuthorisation } from '@shared/types'
import { z } from 'zod'
import { AppError } from '../security/app-error'
import type { GitHubCredential } from './token-store'

export type FetchTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export type ClientIdProvider = () => string | Promise<string>
export type PollDelay = (seconds: number, signal?: AbortSignal) => Promise<void>

export type GitHubTokenStore = {
  readCredential(): Promise<GitHubCredential | null>
  saveCredential(credential: GitHubCredential): Promise<void>
  clearCredential(): Promise<void>
}

export type GitHubDeviceAuthorisationStart = GitHubDeviceAuthorisation & {
  /*
   * This value must remain in the main process. The renderer only needs the
   * user-facing code and verification address.
   */
  deviceCode: string
}

const deviceCodeResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z
    .url()
    .refine((value) => {
      const url = new URL(value)
      return url.protocol === 'https:' && url.hostname === 'github.com'
    }, 'GitHub returned an unsafe verification address.'),
  expires_in: z.number().int().positive(),
  interval: z.number().int().nonnegative().optional()
})

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  refresh_token: z.string().min(1).optional(),
  refresh_token_expires_in: z.number().positive().optional(),
  error: z.string().min(1).optional(),
  error_description: z.string().min(1).optional()
})

const githubUserSchema = z.object({
  login: z.string().min(1),
  avatar_url: z.url().nullable()
})

const DEVICE_FLOW_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const REFRESH_GRANT_TYPE = 'refresh_token'
const DEVICE_FLOW_SCOPE = 'repo read:user'
const SLOW_DOWN_INCREMENT_SECONDS = 5
const EXPIRY_MARGIN_MS = 60_000

export class GitHubAuthService {
  private refreshInFlight: Promise<GitHubCredential> | null = null

  constructor(
    private readonly transport: FetchTransport,
    private readonly getClientId: ClientIdProvider,
    private readonly tokenStore: GitHubTokenStore,
    private readonly delay: PollDelay = wait
  ) {}

  async beginDeviceAuthorisation(): Promise<GitHubDeviceAuthorisationStart> {
    const response = await this.postForm(GITHUB_DEVICE_CODE_URL, {
      client_id: await this.clientId(),
      scope: DEVICE_FLOW_SCOPE
    })

    if (!response.ok) {
      throw await mapGitHubHttpError(response, 'GitHub sign-in could not be started')
    }

    const payload = await parseJson(response, deviceCodeResponseSchema, 'GitHub sign-in')
    return {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      expiresInSeconds: payload.expires_in,
      intervalSeconds: payload.interval ?? 5
    }
  }

  startDeviceAuthorisation(): Promise<GitHubDeviceAuthorisationStart> {
    return this.beginDeviceAuthorisation()
  }

  async pollDeviceAuthorisation(
    deviceCode: string,
    intervalSeconds: number,
    expiresInSeconds: number,
    signal?: AbortSignal
  ): Promise<GitHubAuthStatus> {
    if (deviceCode.length === 0) {
      throw new AppError('UNKNOWN', 'GitHub returned an invalid device code. Start sign-in again.')
    }
    if (!Number.isFinite(intervalSeconds) || intervalSeconds < 0) {
      throw new AppError('UNKNOWN', 'GitHub returned an invalid polling interval. Start sign-in again.')
    }
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw expiredDeviceCodeError()
    }

    const expiresAt = Date.now() + expiresInSeconds * 1_000
    let currentIntervalSeconds = intervalSeconds

    while (true) {
      throwIfAborted(signal)
      if (Date.now() >= expiresAt) {
        throw expiredDeviceCodeError()
      }

      const response = await this.postForm(
        GITHUB_ACCESS_TOKEN_URL,
        {
          client_id: await this.clientId(),
          device_code: deviceCode,
          grant_type: DEVICE_FLOW_GRANT_TYPE
        },
        signal
      )

      if (!response.ok) {
        throw await mapGitHubHttpError(response, 'GitHub sign-in could not be completed')
      }

      const payload = await parseJson(response, tokenResponseSchema, 'GitHub sign-in')
      if (payload.access_token) {
        await this.tokenStore.saveCredential(toCredential(payload))
        try {
          return await this.getStatus(signal)
        } catch (error) {
          if (error instanceof AppError && error.code === 'AUTH_EXPIRED') {
            await this.tokenStore.clearCredential()
          }
          throw error
        }
      }

      switch (payload.error) {
        case 'authorization_pending':
          await this.delay(currentIntervalSeconds, signal)
          break
        case 'slow_down':
          currentIntervalSeconds += SLOW_DOWN_INCREMENT_SECONDS
          await this.delay(currentIntervalSeconds, signal)
          break
        case 'access_denied':
          throw new AppError('ACCESS_DENIED', 'GitHub sign-in was denied. No access was granted.')
        case 'expired_token':
          throw expiredDeviceCodeError()
        default:
          throw new AppError(
            'API_CHANGED',
            'GitHub returned an unexpected sign-in response. Start sign-in again.',
            payload.error_description ?? payload.error
          )
      }
    }
  }

  async getAccessToken(): Promise<string | null> {
    const credential = await this.tokenStore.readCredential()
    if (!credential) return null
    if (!isAccessTokenExpired(credential)) return credential.accessToken
    if (!canRefresh(credential)) {
      await this.tokenStore.clearCredential()
      throw new AppError(
        'AUTH_EXPIRED',
        'GitHub authorisation has expired. Reconnect GitHub.'
      )
    }
    return (await this.refreshAccessToken()).accessToken
  }

  async getStatus(signal?: AbortSignal): Promise<GitHubAuthStatus> {
    const token = await this.getAccessToken()
    if (!token) return disconnectedStatus()

    let response = await this.request(GITHUB_API_URL + '/user', token, signal)
    if (response.status === 401) {
      const credential = await this.tokenStore.readCredential()
      if (credential && canRefresh(credential)) {
        const refreshed = await this.refreshAccessToken()
        response = await this.request(GITHUB_API_URL + '/user', refreshed.accessToken, signal)
      }
    }
    if (response.status === 401) {
      await this.tokenStore.clearCredential()
      throw new AppError('AUTH_EXPIRED', 'GitHub authorisation has expired. Reconnect GitHub.')
    }
    if (!response.ok) {
      throw await mapGitHubHttpError(response, 'GitHub account details could not be loaded')
    }

    const user = await parseJson(response, githubUserSchema, 'GitHub account details')
    return {
      state: 'connected',
      username: user.login,
      avatarUrl: user.avatar_url
    }
  }

  async disconnect(): Promise<GitHubAuthStatus> {
    await this.tokenStore.clearCredential()
    return disconnectedStatus()
  }

  private refreshAccessToken(): Promise<GitHubCredential> {
    if (this.refreshInFlight) return this.refreshInFlight

    const refresh = this.performRefresh()
    this.refreshInFlight = refresh
    void refresh.then(
      () => {
        this.refreshInFlight = null
      },
      () => {
        this.refreshInFlight = null
      }
    )
    return refresh
  }

  private async performRefresh(): Promise<GitHubCredential> {
    const credential = await this.tokenStore.readCredential()
    if (!credential?.refreshToken || !canRefresh(credential)) {
      await this.tokenStore.clearCredential()
      throw new AppError(
        'AUTH_EXPIRED',
        'GitHub authorisation has expired. Reconnect GitHub.'
      )
    }

    const response = await this.postForm(GITHUB_ACCESS_TOKEN_URL, {
      client_id: await this.clientId(),
      grant_type: REFRESH_GRANT_TYPE,
      refresh_token: credential.refreshToken
    })
    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        let failure: z.infer<typeof tokenResponseSchema> | null = null
        try {
          failure = await parseJson(
            response,
            tokenResponseSchema,
            'GitHub token refresh'
          )
        } catch {
          // Fall back to the HTTP status when GitHub does not return a token error body.
        }
        if (
          failure?.error === 'bad_refresh_token' ||
          failure?.error === 'expired_token' ||
          failure?.error === 'invalid_grant'
        ) {
          await this.tokenStore.clearCredential()
          throw new AppError(
            'AUTH_EXPIRED',
            'GitHub refresh authorisation has expired. Reconnect GitHub.'
          )
        }
      }
      throw await mapGitHubHttpError(response, 'GitHub authorisation could not be refreshed')
    }
    const payload = await parseJson(response, tokenResponseSchema, 'GitHub token refresh')
    if (!payload.access_token) {
      switch (payload.error) {
        case 'bad_refresh_token':
        case 'expired_token':
        case 'invalid_grant':
          await this.tokenStore.clearCredential()
          throw new AppError(
            'AUTH_EXPIRED',
            'GitHub refresh authorisation has expired. Reconnect GitHub.'
          )
        default:
          throw new AppError(
            'API_CHANGED',
            'GitHub returned an unexpected token refresh response.',
            payload.error_description ?? payload.error
          )
      }
    }

    const refreshed = toCredential(
      {
        ...payload,
        refresh_token: payload.refresh_token ?? credential.refreshToken
      },
      credential
    )
    await this.tokenStore.saveCredential(refreshed)
    return refreshed
  }

  private async clientId(): Promise<string> {
    const clientId = (await this.getClientId()).trim()
    if (clientId.length === 0) {
      throw new AppError(
        'UNKNOWN',
        'GitHub sign-in is not configured. Set a GitHub OAuth client ID and restart the app.'
      )
    }
    return clientId
  }

  private postForm(
    url: string,
    fields: Record<string, string>,
    signal?: AbortSignal
  ): Promise<Response> {
    const body = new URLSearchParams(fields)
    return this.request(url, null, signal, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    })
  }

  private async request(
    url: string,
    token: string | null,
    signal?: AbortSignal,
    init: RequestInit = {}
  ): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('User-Agent', 'LeetCodeDesktop/0.1')
    if (token) headers.set('Authorization', `Bearer ${token}`)

    try {
      return await this.transport(url, {
        ...init,
        headers,
        ...(signal ? { signal } : {})
      })
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw new AppError(
        'OFFLINE',
        'GitHub could not be reached. Check your connection and try again.',
        error instanceof Error ? error.message : undefined
      )
    }
  }
}

async function parseJson<T>(response: Response, schema: z.ZodType<T>, operation: string): Promise<T> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new AppError(
      'API_CHANGED',
      `${operation} returned an unreadable response.`,
      error instanceof Error ? error.message : undefined
    )
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    throw new AppError(
      'API_CHANGED',
      `${operation} returned an unexpected response. GitHub may have changed its API.`
    )
  }
  return parsed.data
}

async function mapGitHubHttpError(response: Response, operation: string): Promise<AppError> {
  const detail = await responseDetail(response)
  switch (response.status) {
    case 401:
      return new AppError('AUTH_EXPIRED', 'GitHub authorisation has expired. Reconnect GitHub.', detail)
    case 403:
      return new AppError('ACCESS_DENIED', 'GitHub denied permission for this request.', detail)
    case 404:
      return new AppError(
        'ACCESS_DENIED',
        'The requested GitHub resource was not found or is not accessible.',
        detail
      )
    case 409:
      return new AppError('GITHUB_CONFLICT', 'The GitHub resource changed. Refresh it and try again.', detail)
    case 429:
      return new AppError(
        'RATE_LIMITED',
        'GitHub is receiving too many requests. Wait a moment before trying again.',
        detail
      )
    default:
      return new AppError('API_CHANGED', `${operation}.`, detail)
  }
}

async function responseDetail(response: Response): Promise<string> {
  const prefix = `GitHub returned HTTP ${response.status}.`
  try {
    const payload = (await response.json()) as unknown
    if (
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof payload.message === 'string'
    ) {
      return `${prefix} ${payload.message.slice(0, 300)}`
    }
  } catch {
    // A status-only diagnostic is sufficient when the response is not JSON.
  }
  return prefix
}

function disconnectedStatus(): GitHubAuthStatus {
  return {
    state: 'disconnected',
    username: null,
    avatarUrl: null
  }
}

function toCredential(
  payload: z.infer<typeof tokenResponseSchema>,
  previous?: GitHubCredential
): GitHubCredential {
  if (!payload.access_token) {
    throw new AppError('API_CHANGED', 'GitHub did not return an access token.')
  }
  const now = Date.now()
  const credential: GitHubCredential = {
    accessToken: payload.access_token
  }
  if (payload.expires_in !== undefined) {
    credential.accessTokenExpiresAtMs = now + payload.expires_in * 1_000
  }
  if (payload.refresh_token) {
    credential.refreshToken = payload.refresh_token
  } else if (previous?.refreshToken) {
    credential.refreshToken = previous.refreshToken
  }
  if (payload.refresh_token_expires_in !== undefined) {
    credential.refreshTokenExpiresAtMs = now + payload.refresh_token_expires_in * 1_000
  } else if (previous?.refreshTokenExpiresAtMs !== undefined) {
    credential.refreshTokenExpiresAtMs = previous.refreshTokenExpiresAtMs
  }
  return credential
}

function isAccessTokenExpired(credential: GitHubCredential): boolean {
  return (
    credential.accessTokenExpiresAtMs !== undefined &&
    credential.accessTokenExpiresAtMs <= Date.now() + EXPIRY_MARGIN_MS
  )
}

function canRefresh(credential: GitHubCredential): boolean {
  return (
    Boolean(credential.refreshToken) &&
    (credential.refreshTokenExpiresAtMs === undefined ||
      credential.refreshTokenExpiresAtMs > Date.now())
  )
}

function expiredDeviceCodeError(): AppError {
  return new AppError('AUTH_EXPIRED', 'The GitHub sign-in code expired. Start sign-in again.')
}

function abortError(): DOMException {
  return new DOMException('GitHub authorisation was cancelled.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function wait(seconds: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (seconds === 0) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, seconds * 1_000)

    const onAbort = (): void => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
