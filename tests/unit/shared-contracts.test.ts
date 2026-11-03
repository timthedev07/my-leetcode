import { describe, expect, it } from 'vitest'
import { appInfoSchema, externalUrlSchema } from '@shared/schemas'

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
})

