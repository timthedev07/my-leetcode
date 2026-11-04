import { describe, expect, it } from 'vitest'
import { ATTEMPT_CLEANUP_INTERVAL_MS } from '@shared/constants'
import { appInfoSchema, externalUrlSchema } from '@shared/schemas'
import { buildContentSecurityPolicy } from '../../src/main/security/csp-policy'

describe('shared contracts', () => {
  it('accepts only allowlisted external origins', () => {
    expect(externalUrlSchema.safeParse('https://leetcode.com/problems/two-sum/').success).toBe(true)
    expect(externalUrlSchema.safeParse('https://github.com/login/device').success).toBe(true)
    expect(externalUrlSchema.safeParse('https://example.com').success).toBe(false)
    expect(externalUrlSchema.safeParse('file:///etc/passwd').success).toBe(false)
    expect(externalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)
  })

  it('validates app information at the IPC boundary', () => {
    expect(appInfoSchema.parse({ version: '0.1.0', platform: 'darwin', isPackaged: false })).toEqual({
      version: '0.1.0',
      platform: 'darwin',
      isPackaged: false
    })
    expect(() => appInfoSchema.parse({ version: '', platform: 'unknown', isPackaged: 'yes' })).toThrow()
  })

  it('keeps the daily retention timer within the platform limit', () => {
    expect(ATTEMPT_CLEANUP_INTERVAL_MS).toBe(86_400_000)
    expect(ATTEMPT_CLEANUP_INTERVAL_MS).toBeLessThan(2 ** 31)
  })

  it('allows the Vite refresh preamble only in development', () => {
    expect(buildContentSecurityPolicy(true)).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
    )
    expect(buildContentSecurityPolicy(true)).toContain('ws://localhost:*')
    expect(buildContentSecurityPolicy(false)).toContain(
      "script-src 'self' 'wasm-unsafe-eval'"
    )
    expect(buildContentSecurityPolicy(false)).not.toContain("script-src 'self' 'unsafe-inline'")
    expect(buildContentSecurityPolicy(false)).not.toMatch(/(?:^|\s)'unsafe-eval'(?:\s|;|$)/)
    expect(buildContentSecurityPolicy(false)).not.toContain('localhost')
  })
})

