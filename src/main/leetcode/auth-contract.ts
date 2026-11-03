import type { LeetCodeAuthStatus } from '@shared/types'

/**
 * An authenticated LeetCode request session. Implementations must keep cookies
 * and CSRF values inside the main process.
 */
export interface LeetCodeAuthenticatedSession {
  /**
   * Sends a request to https://leetcode.com. Relative paths must begin with `/`.
   * Implementations reject every other origin.
   */
  request(pathOrUrl: string | URL, init?: RequestInit): Promise<Response>

  /**
   * Returns the CSRF token held by the browser context, if LeetCode has set one.
   */
  getCsrfToken?(): Promise<string | null>
}

export type LeetCodeAuthStatusListener = (
  status: Readonly<LeetCodeAuthStatus>
) => void

export interface LeetCodeBrowserLaunchOptions {
  profileDirectory: string
  headless: boolean
  executablePath: string
}

/**
 * A main-process-only browser boundary. The underlying context and request
 * objects are deliberately not exposed outside this interface.
 */
export interface LeetCodeBrowserRuntime {
  readonly session: LeetCodeAuthenticatedSession
  showLogin(): Promise<void>
  close(): Promise<void>
  onClosed(listener: () => void): () => void
}

export type LeetCodeBrowserLauncher = (
  options: LeetCodeBrowserLaunchOptions
) => Promise<LeetCodeBrowserRuntime>

export interface LeetCodeAuthDependencies {
  launchBrowser?: LeetCodeBrowserLauncher
  resolveExecutablePath?: () => string
}

export interface LeetCodeAuthOptions {
  /**
   * A dedicated Playwright profile directory, normally within Electron's
   * userData directory.
   */
  profileDirectory: string
  onStatusChange?: LeetCodeAuthStatusListener
  pollIntervalMs?: number
  loginTimeoutMs?: number
  dependencies?: LeetCodeAuthDependencies
}

export type LeetCodeDisconnectOptions =
  | { deleteProfile: false }
  | { deleteProfile: true; profileDeletionConfirmed: true }
