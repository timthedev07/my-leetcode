import type { BrowserContext, APIResponse } from 'playwright'
import { describe, expect, it, vi } from 'vitest'
import type { LeetCodeAuthStatus } from '../../src/shared/types'
import type {
  LeetCodeAuthStatusListener,
  LeetCodeBrowserLaunchOptions,
  LeetCodeBrowserRuntime
} from '../../src/main/leetcode/auth-contract'
import { LeetCodeAuthService } from '../../src/main/leetcode/auth'
import { PlaywrightRequestSession } from '../../src/main/leetcode/playwright-fetch'

function userStatusResponse(
  isSignedIn: boolean,
  username: string | null
): Response {
  return new Response(
    JSON.stringify({
      data: {
        userStatus: {
          isSignedIn,
          username
        }
      }
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }
  )
}

function createAuthHarness(
  initialIsSignedIn: boolean,
  initialUsername: string | null
): {
  auth: LeetCodeAuthService
  launchBrowser: ReturnType<typeof vi.fn>
  runtime: LeetCodeBrowserRuntime
  statuses: LeetCodeAuthStatus[]
  setIsSignedIn: (isSignedIn: boolean, username?: string | null) => void
} {
  let isSignedIn = initialIsSignedIn
  let username = initialUsername
  const statuses: LeetCodeAuthStatus[] = []

  const runtime: LeetCodeBrowserRuntime = {
    session: {
      request: vi.fn(async () =>
        userStatusResponse(isSignedIn, username)
      )
    },
    showLogin: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    onClosed: vi.fn(() => () => undefined)
  }
  const launchBrowser = vi.fn(
    async (_options: LeetCodeBrowserLaunchOptions) => runtime
  )
  const onStatusChange: LeetCodeAuthStatusListener = (status) => {
    statuses.push({ ...status })
  }
  const auth = new LeetCodeAuthService({
    profileDirectory: '/tmp/leetcode-auth-test-profile',
    pollIntervalMs: 60_000,
    loginTimeoutMs: 120_000,
    onStatusChange,
    dependencies: {
      launchBrowser,
      resolveExecutablePath: () => '/tmp/playwright-chromium'
    }
  })

  return {
    auth,
    launchBrowser,
    runtime,
    statuses,
    setIsSignedIn: (nextIsSignedIn, nextUsername = null) => {
      isSignedIn = nextIsSignedIn
      username = nextUsername
    }
  }
}

describe('LeetCodeAuthService', () => {
  it('restores a persistent headless session and emits connected status', async () => {
    const harness = createAuthHarness(true, 'ada')

    await expect(harness.auth.restoreSession()).resolves.toEqual({
      state: 'connected',
      username: 'ada',
      message: null
    })

    expect(harness.launchBrowser).toHaveBeenCalledWith({
      profileDirectory: '/tmp/leetcode-auth-test-profile',
      headless: true,
      executablePath: '/tmp/playwright-chromium'
    })
    expect(harness.statuses.map((status) => status.state)).toEqual([
      'connecting',
      'connected'
    ])
    await harness.auth.dispose()
  })

  it('maps an unsigned-in persistent session to expired status', async () => {
    const harness = createAuthHarness(false, null)

    await expect(harness.auth.restoreSession()).resolves.toMatchObject({
      state: 'expired',
      username: null
    })

    expect(harness.runtime.close).toHaveBeenCalledOnce()
    expect(harness.statuses.map((status) => status.state)).toEqual([
      'connecting',
      'expired'
    ])
  })

  it('maps an unauthorised response to expired status', async () => {
    const harness = createAuthHarness(false, null)
    harness.runtime.session.request = vi.fn(
      async () => new Response(null, { status: 401 })
    )

    await expect(harness.auth.restoreSession()).resolves.toMatchObject({
      state: 'expired',
      username: null
    })

    expect(harness.statuses.at(-1)?.state).toBe('expired')
  })

  it('opens a visible login and transitions to connected after validation', async () => {
    const harness = createAuthHarness(false, null)

    await expect(harness.auth.connect()).resolves.toMatchObject({
      state: 'connecting'
    })
    expect(harness.launchBrowser).toHaveBeenCalledWith({
      profileDirectory: '/tmp/leetcode-auth-test-profile',
      headless: false,
      executablePath: '/tmp/playwright-chromium'
    })
    expect(harness.runtime.showLogin).toHaveBeenCalledOnce()

    harness.setIsSignedIn(true, 'grace')
    await expect(harness.auth.refreshStatus()).resolves.toEqual({
      state: 'connected',
      username: 'grace',
      message: null
    })

    await harness.auth.disconnect({ deleteProfile: false })
    expect(harness.statuses.map((status) => status.state)).toEqual([
      'connecting',
      'connected',
      'disconnected'
    ])
  })

  it('refuses permanent profile deletion without explicit confirmation', async () => {
    const harness = createAuthHarness(false, null)
    const unconfirmedOptions = {
      deleteProfile: true,
      profileDeletionConfirmed: false
    } as unknown as Parameters<LeetCodeAuthService['disconnect']>[0]

    await expect(
      harness.auth.disconnect(unconfirmedOptions)
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    expect(harness.runtime.close).not.toHaveBeenCalled()
  })
})

describe('PlaywrightRequestSession', () => {
  it('uses context cookies for CSRF and converts Playwright responses', async () => {
    const apiResponse = {
      status: () => 200,
      statusText: () => 'OK',
      headersArray: () => [
        { name: 'content-type', value: 'application/json' }
      ],
      body: async () => Buffer.from('{"ok":true}'),
      dispose: async () => undefined
    } as APIResponse
    const fetchRequest = vi.fn(async () => apiResponse)
    const context = {
      request: { fetch: fetchRequest },
      cookies: vi.fn(async () => [
        {
          name: 'csrftoken',
          value: 'csrf-from-profile',
          domain: 'leetcode.com',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: true,
          sameSite: 'Lax' as const
        }
      ])
    } as unknown as Pick<BrowserContext, 'cookies' | 'request'>
    const session = new PlaywrightRequestSession(context)

    const response = await session.request('/graphql/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"query":"query globalData { userStatus { isSignedIn } }"}'
    })

    expect(await response.json()).toEqual({ ok: true })
    expect(fetchRequest).toHaveBeenCalledWith(
      'https://leetcode.com/graphql/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-csrftoken': 'csrf-from-profile'
        })
      })
    )
  })

  it('rejects requests outside the LeetCode origin', async () => {
    const fetchRequest = vi.fn()
    const context = {
      request: { fetch: fetchRequest },
      cookies: vi.fn(async () => [])
    } as unknown as Pick<BrowserContext, 'cookies' | 'request'>
    const session = new PlaywrightRequestSession(context)

    await expect(
      session.request('https://example.com/private')
    ).rejects.toMatchObject({ code: 'ACCESS_DENIED' })
    expect(fetchRequest).not.toHaveBeenCalled()
  })
})
