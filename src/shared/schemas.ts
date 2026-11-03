import { z } from 'zod'

export const externalUrlSchema = z
  .string()
  .url()
  .refine((value) => ['https://leetcode.com', 'https://github.com', 'https://docs.github.com'].some((origin) => value.startsWith(origin)), {
    message: 'Only approved external sites may be opened.'
  })

export const appInfoSchema = z.object({
  version: z.string().min(1),
  platform: z.enum(['aix', 'android', 'darwin', 'freebsd', 'haiku', 'linux', 'openbsd', 'sunos', 'win32', 'cygwin', 'netbsd']),
  isPackaged: z.boolean()
})

export const ipcResultSchema = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({
      ok: z.literal(false),
      error: z.object({
        code: z.enum([
          'OFFLINE',
          'AUTH_EXPIRED',
          'ACCESS_DENIED',
          'PREMIUM_LOCKED',
          'RATE_LIMITED',
          'API_CHANGED',
          'JUDGE_FAILED',
          'GITHUB_CONFLICT',
          'STORAGE_FAILED',
          'UNKNOWN'
        ]),
        message: z.string().min(1),
        details: z.string().optional()
      })
    })
  ])

