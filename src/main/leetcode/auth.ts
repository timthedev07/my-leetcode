import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { chromium, type BrowserContext } from 'playwright'
import { z } from 'zod'
import { LEETCODE_GRAPHQL_URL, LEETCODE_ORIGIN } from '@shared/constants'
import type { LeetCodeAuthStatus } from '@shared/types'
import { AppError } from '../security/app-error'
import type {
  LeetCodeAuthOptions,
  LeetCodeAuthStatusListener,
  LeetCodeAuthenticatedSession,
  LeetCodeBrowserLauncher,
  LeetCodeBrowserRuntime,
  LeetCodeDisconnectOptions
} from './auth-contract'
import { PlaywrightRequestSession } from './playwright-fetch'
import { USER_STATUS_DOCUMENT } from './queries'

const DEFAULT_POLL_INTERVAL_MS = 1_500
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60 * 1_000
const LOGIN_PAGE_TIMEOUT_MS = 30_000

class AuthOperationCancelledError extends Error {
  constructor() {
    super('LeetCode authentication operation was cancelled.')
    this.name = 'AuthOperationCancelledError'
  }
}

const userStatusResponseSchema = z.object({
  data: z
    .object({
      userStatus: z
        .object({
          isSignedIn: z.boolean(),
          username: z.string().nullable()
        })
        .nullable()
    })
    .nullable()
    .optional(),
  errors: z
    .array(
      z.object({
        message: z.string()
      })
    )
    .optional()
})

type AuthVerification =
  | { state: 'authenticated'; username: string }
  | { state: 'expired' }

/**
 * Owns LeetCode's persistent Chromium profile and authenticated requests. The
 * browser context is never returned across this service's boundary.
 */
export class LeetCodeAuthService {
  private readonly profileDirectory: string
  private readonly onStatusChange?: LeetCodeAuthStatusListener
  private readonly pollIntervalMs: number
  private readonly loginTimeoutMs: number
  private readonly launchBrowser: LeetCodeBrowserLauncher
  private readonly resolveExecutablePath: () => string

  private currentStatus: LeetCodeAuthStatus = {
    state: 'disconnected',
    username: null,
    message: null
  }
  private runtime: LeetCodeBrowserRuntime | null = null
  private unsubscribeFromClose: (() => void) | null = null
  private runtimeIsHeadless = false
  private generation = 0
  private loginAbortController: AbortController | null = null
  private connectTask: Promise<LeetCodeAuthStatus> | null = null
  private restoreTask: Promise<LeetCodeAuthStatus> | null = null
  private closingRuntime = false

  constructor(options: LeetCodeAuthOptions) {
    if (!options.profileDirectory.trim()) {
      throw new AppError(
        'STORAGE_FAILED',
        'A LeetCode browser profile directory is required.'
      )
    }

    this.profileDirectory = options.profileDirectory
    this.pollIntervalMs = positiveDuration(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS
    )
    this.loginTimeoutMs = positiveDuration(
      options.loginTimeoutMs,
      DEFAULT_LOGIN_TIMEOUT_MS
    )
    this.launchBrowser =
      options.dependencies?.launchBrowser ?? launchPlaywrightBrowser
    this.resolveExecutablePath =
      options.dependencies?.resolveExecutablePath ??
      resolvePlaywrightChromiumExecutable

    if (options.onStatusChange) {
      this.onStatusChange = options.onStatusChange
    }
  }

  getStatus(): Readonly<LeetCodeAuthStatus> {
    return { ...this.currentStatus }
  }

  /**
   * Opens the real LeetCode site in a visible Playwright profile. The returned
   * promise resolves once the initial check is complete; login polling then
   * continues in the background and emits status changes.
   */
  async connect(): Promise<LeetCodeAuthStatus> {
    if (
      this.currentStatus.state === 'connected' &&
      this.runtime !== null
    ) {
      return this.getStatus()
    }
    if (this.connectTask) return this.connectTask

    this.connectTask = (async () => {
      if (this.restoreTask) await this.restoreTask
      if (
        this.currentStatus.state === 'connected' &&
        this.runtime !== null
      ) {
        return this.getStatus()
      }
      return this.startVisibleConnection()
    })().finally(() => {
      this.connectTask = null
    })
    return this.connectTask
  }

  /**
   * Reopens the persistent profile headlessly and validates the saved session.
   * Call this on application start rather than assuming that a profile is valid.
   */
  async restoreSession(): Promise<LeetCodeAuthStatus> {
    if (
      this.currentStatus.state === 'connected' &&
      this.runtime !== null
    ) {
      return this.getStatus()
    }
    if (this.connectTask) return this.connectTask
    if (this.restoreTask) return this.restoreTask

    this.restoreTask = this.restorePersistentSession().finally(() => {
      this.restoreTask = null
    })
    return this.restoreTask
  }

  /**
   * Validates the active session without opening a new browser. Useful when
   * returning to the app after a period of inactivity.
   */
  async refreshStatus(): Promise<LeetCodeAuthStatus> {
    if (this.currentStatus.state === 'disconnected') {
      return this.getStatus()
    }
    if (this.connectTask) return this.connectTask
    if (this.restoreTask) return this.restoreTask
    if (!this.runtime) return this.restoreSession()

    const generation = this.generation
    const runtime = this.runtime
    try {
      const verification = await verifySession(runtime.session)
      if (generation !== this.generation || runtime !== this.runtime) {
        return this.getStatus()
      }
      if (verification.state === 'authenticated') {
        this.setStatus({
          state: 'connected',
          username: verification.username,
          message: null
        })
      } else {
        await this.closeRuntime()
        this.setStatus(expiredStatus())
      }
      return this.getStatus()
    } catch (error) {
      const mapped = mapAuthenticationError(error)
      if (generation !== this.generation || runtime !== this.runtime) {
        throw mapped
      }
      await this.closeRuntime()
      this.setStatus(expiredStatus(mapped.message))
      throw mapped
    }
  }

  async getAuthenticatedSession(): Promise<LeetCodeAuthenticatedSession> {
    if (this.currentStatus.state === 'connecting') {
      throw new AppError(
        'AUTH_EXPIRED',
        'LeetCode authentication is still being established.'
      )
    }
    if (
      this.currentStatus.state !== 'connected' ||
      this.runtime === null
    ) {
      await this.restoreSession()
    }

    if (
      this.currentStatus.state !== 'connected' ||
      this.runtime === null
    ) {
      throw new AppError(
        'AUTH_EXPIRED',
        'Connect your LeetCode account to continue.'
      )
    }

    return this.runtime.session
  }

  /**
   * Closes the browser profile. Permanent deletion requires the caller to
   * confirm that the UI has obtained explicit user consent.
   */
  async disconnect(options: LeetCodeDisconnectOptions): Promise<void> {
    if (
      options.deleteProfile &&
      options.profileDeletionConfirmed !== true
    ) {
      throw new AppError(
        'ACCESS_DENIED',
        'Deleting the LeetCode browser profile requires explicit confirmation.'
      )
    }

    this.generation += 1
    this.loginAbortController?.abort()
    this.loginAbortController = null
    await this.closeRuntime()

    if (options.deleteProfile) {
      await rm(this.profileDirectory, { recursive: true, force: true })
    }

    this.setStatus({
      state: 'disconnected',
      username: null,
      message: null
    })
  }

  /**
   * Closes the browser without deleting its saved profile. Intended for app
   * shutdown.
   */
  async dispose(): Promise<void> {
    this.generation += 1
    this.loginAbortController?.abort()
    this.loginAbortController = null
    await this.closeRuntime()
  }

  private async startVisibleConnection(): Promise<LeetCodeAuthStatus> {
    const generation = this.nextGeneration()
    this.setStatus({
      state: 'connecting',
      username: null,
      message: 'Sign in to LeetCode in the browser window.'
    })

    try {
      const runtime = await this.ensureRuntime(false, generation)
      if (generation !== this.generation) return this.getStatus()
      await runtime.showLogin()
      if (generation !== this.generation) return this.getStatus()

      const verification = await verifySession(runtime.session)
      if (generation !== this.generation) return this.getStatus()
      if (verification.state === 'authenticated') {
        this.setStatus({
          state: 'connected',
          username: verification.username,
          message: null
        })
        return this.getStatus()
      }

      this.watchForLogin(generation)
      return this.getStatus()
    } catch (error) {
      if (generation !== this.generation) return this.getStatus()
      const mapped = mapAuthenticationError(error)
      if (generation === this.generation) {
        await this.closeRuntime()
        this.setStatus(expiredStatus(mapped.message))
      }
      throw mapped
    }
  }

  private async restorePersistentSession(): Promise<LeetCodeAuthStatus> {
    const generation = this.nextGeneration()
    this.setStatus({
      state: 'connecting',
      username: null,
      message: 'Checking your saved LeetCode session.'
    })

    try {
      const runtime = await this.ensureRuntime(true, generation)
      if (generation !== this.generation) return this.getStatus()
      const verification = await verifySession(runtime.session)
      if (generation !== this.generation) return this.getStatus()

      if (verification.state === 'authenticated') {
        this.setStatus({
          state: 'connected',
          username: verification.username,
          message: null
        })
      } else {
        await this.closeRuntime()
        this.setStatus(expiredStatus())
      }
      return this.getStatus()
    } catch (error) {
      if (generation !== this.generation) return this.getStatus()
      const mapped = mapAuthenticationError(error)
      if (generation === this.generation) {
        await this.closeRuntime()
        this.setStatus(expiredStatus(mapped.message))
      }
      throw mapped
    }
  }

  private async ensureRuntime(
    headless: boolean,
    generation: number
  ): Promise<LeetCodeBrowserRuntime> {
    if (generation !== this.generation) {
      throw new AuthOperationCancelledError()
    }
    if (this.runtime) {
      if (headless || !this.runtimeIsHeadless) return this.runtime
      await this.closeRuntime()
    }

    let runtime: LeetCodeBrowserRuntime
    try {
      runtime = await this.launchBrowser({
        profileDirectory: this.profileDirectory,
        headless,
        executablePath: this.resolveExecutablePath()
      })
    } catch (error) {
      throw mapBrowserLaunchError(error)
    }
    if (generation !== this.generation) {
      await runtime.close()
      throw new AuthOperationCancelledError()
    }

    this.runtime = runtime
    this.runtimeIsHeadless = headless
    this.unsubscribeFromClose = runtime.onClosed(() => {
      if (this.runtime !== runtime) return
      this.runtime = null
      this.runtimeIsHeadless = false
      this.unsubscribeFromClose = null
      if (!this.closingRuntime) {
        this.setStatus({
          state: 'disconnected',
          username: null,
          message: 'The LeetCode browser window was closed.'
        })
      }
    })
    return runtime
  }

  private async closeRuntime(): Promise<void> {
    const runtime = this.runtime
    if (!runtime) return

    this.closingRuntime = true
    this.runtime = null
    this.runtimeIsHeadless = false
    this.unsubscribeFromClose?.()
    this.unsubscribeFromClose = null
    try {
      await runtime.close()
    } finally {
      this.closingRuntime = false
    }
  }

  private watchForLogin(generation: number): void {
    this.loginAbortController?.abort()
    const controller = new AbortController()
    this.loginAbortController = controller

    void this.pollForLogin(generation, controller.signal).catch((error) => {
      if (controller.signal.aborted || generation !== this.generation) return
      const mapped = mapAuthenticationError(error)
      void this.closeRuntime().finally(() => {
        if (generation !== this.generation) return
        this.setStatus(expiredStatus(mapped.message))
      })
    })
  }

  private async pollForLogin(
    generation: number,
    signal: AbortSignal
  ): Promise<void> {
    const deadline = Date.now() + this.loginTimeoutMs

    while (
      !signal.aborted &&
      generation === this.generation &&
      Date.now() < deadline
    ) {
      await abortableDelay(this.pollIntervalMs, signal)
      if (signal.aborted || generation !== this.generation) return

      const runtime = this.runtime
      if (!runtime) return

      try {
        const verification = await verifySession(runtime.session)
        if (signal.aborted || generation !== this.generation) return
        if (verification.state === 'authenticated') {
          this.setStatus({
            state: 'connected',
            username: verification.username,
            message: null
          })
          return
        }
      } catch (error) {
        const mapped = mapAuthenticationError(error)
        if (mapped.code !== 'AUTH_EXPIRED') throw mapped
      }
    }

    if (!signal.aborted && generation === this.generation) {
      await this.closeRuntime()
      this.setStatus(
        expiredStatus(
          'LeetCode sign-in was not completed. Try connecting again when you are ready.'
        )
      )
    }
  }

  private nextGeneration(): number {
    this.generation += 1
    this.loginAbortController?.abort()
    this.loginAbortController = null
    return this.generation
  }

  private setStatus(status: LeetCodeAuthStatus): void {
    if (
      status.state === this.currentStatus.state &&
      status.username === this.currentStatus.username &&
      status.message === this.currentStatus.message
    ) {
      return
    }

    this.currentStatus = { ...status }
    this.onStatusChange?.({ ...status })
  }
}

export function resolvePlaywrightChromiumExecutable(): string {
  const configuredPath = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim()
  const resourcesPath = (
    process as NodeJS.Process & { resourcesPath?: string }
  ).resourcesPath
  const defaultApp = (
    process as NodeJS.Process & { defaultApp?: boolean }
  ).defaultApp
  const packagedBrowsersPath =
    resourcesPath && defaultApp !== true
      ? join(resourcesPath, 'playwright')
      : undefined

  if (configuredPath && !existsSync(configuredPath)) {
    throw chromiumUnavailableError(
      `PLAYWRIGHT_BROWSERS_PATH points to a missing directory: ${configuredPath}`
    )
  }
  if (
    !configuredPath &&
    packagedBrowsersPath &&
    !existsSync(packagedBrowsersPath)
  ) {
    throw chromiumUnavailableError(
      `The bundled Playwright browser directory is missing: ${packagedBrowsersPath}`
    )
  }
  const browsersPath = configuredPath || packagedBrowsersPath
  if (browsersPath) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath
  }

  let executablePath: string
  try {
    executablePath = chromium.executablePath()
  } catch (error) {
    throw mapBrowserLaunchError(error)
  }

  if (!existsSync(executablePath)) {
    throw chromiumUnavailableError(
      `Playwright expected Chromium at ${executablePath}`
    )
  }

  return executablePath
}

async function launchPlaywrightBrowser(
  options: Parameters<LeetCodeBrowserLauncher>[0]
): Promise<LeetCodeBrowserRuntime> {
  let context: BrowserContext
  try {
    context = await chromium.launchPersistentContext(
      options.profileDirectory,
      {
        headless: options.headless,
        executablePath: options.executablePath,
        chromiumSandbox: true,
        colorScheme: 'dark',
        locale: 'en-US',
        viewport: { width: 1_280, height: 900 }
      }
    )
  } catch (error) {
    throw chromiumUnavailableError(
      error instanceof Error ? error.message : undefined
    )
  }

  const requestSession = new PlaywrightRequestSession(context)
  return {
    session: requestSession,
    showLogin: async () => {
      const page = context.pages()[0] ?? (await context.newPage())
      await page.goto(`${LEETCODE_ORIGIN}/`, {
        waitUntil: 'domcontentloaded',
        timeout: LOGIN_PAGE_TIMEOUT_MS
      })
      await page.bringToFront()
    },
    close: () => context.close(),
    onClosed: (listener) => {
      context.on('close', listener)
      return () => context.off('close', listener)
    }
  }
}

async function verifySession(
  session: LeetCodeAuthenticatedSession
): Promise<AuthVerification> {
  const response = await session.request(LEETCODE_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Referer: `${LEETCODE_ORIGIN}/`,
      'x-operation-name': 'globalData'
    },
    body: JSON.stringify({
      query: USER_STATUS_DOCUMENT,
      variables: {},
      operationName: 'globalData'
    })
  })

  if (response.status === 401 || response.status === 403) {
    return { state: 'expired' }
  }
  if (response.status === 429) {
    throw new AppError(
      'RATE_LIMITED',
      'LeetCode is receiving too many requests. Wait a moment before trying again.'
    )
  }
  if (!response.ok) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unexpected account status. The service may have changed.',
      `HTTP ${response.status}`
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unreadable account status. The service may have changed.'
    )
  }

  const parsed = userStatusResponseSchema.safeParse(raw)
  if (!parsed.success) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned an unexpected account status. The service may have changed.'
    )
  }

  if (parsed.data.errors?.length) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode could not confirm the account status. Try again or open LeetCode in the browser.',
      parsed.data.errors.map((error) => error.message).join(' ')
    )
  }

  const responseData = parsed.data.data
  if (!responseData) {
    throw new AppError(
      'API_CHANGED',
      'LeetCode returned no account status. The service may have changed.'
    )
  }
  const userStatus = responseData.userStatus
  const username = userStatus?.username?.trim()
  if (userStatus?.isSignedIn === true && username) {
    return { state: 'authenticated', username }
  }

  return { state: 'expired' }
}

function expiredStatus(
  message = 'Your LeetCode session has expired. Reconnect to continue.'
): LeetCodeAuthStatus {
  return {
    state: 'expired',
    username: null,
    message
  }
}

function mapAuthenticationError(error: unknown): AppError {
  if (error instanceof AppError) return error
  return new AppError(
    'UNKNOWN',
    'LeetCode authentication could not be completed.',
    error instanceof Error ? error.message : undefined
  )
}

function mapBrowserLaunchError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (isMissingChromiumError(error)) {
    return chromiumUnavailableError(
      error instanceof Error ? error.message : undefined
    )
  }
  return new AppError(
    'UNKNOWN',
    'The LeetCode browser window could not be started. Close any existing LeetCode browser session and try again.',
    error instanceof Error ? error.message : undefined
  )
}

function isMissingChromiumError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /executable|browser.*not found|ENOENT|spawn/i.test(error.message)
  )
}

function chromiumUnavailableError(details?: string): AppError {
  return new AppError(
    'UNKNOWN',
    'Playwright Chromium is unavailable. Run `yarn playwright install chromium` in development, or reinstall the application so its bundled browser is restored.',
    details
  )
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    const cancel = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
  })
}

function abortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError')
}
