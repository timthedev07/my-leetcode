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

export const difficultySchema = z.enum(['Easy', 'Medium', 'Hard'])

export const topicTagSchema = z.object({
  name: z.string(),
  slug: z.string()
})

export const problemSummarySchema = z.object({
  frontendId: z.string().regex(/^\d+$/),
  title: z.string().min(1),
  titleSlug: z.string().regex(/^[a-z0-9-]+$/),
  difficulty: difficultySchema,
  isPaidOnly: z.boolean(),
  topicTags: z.array(topicTagSchema)
})

export const problemDetailSchema = problemSummarySchema.extend({
  internalId: z.string().regex(/^\d+$/),
  contentHtml: z.string(),
  hints: z.array(z.string()),
  starterCode: z.string(),
  exampleTestcases: z.string()
})

const editorPositionSchema = z.object({
  lineNumber: z.number().int().positive(),
  column: z.number().int().positive()
})

export const persistedEditorStateSchema = z.object({
  cursor: editorPositionSchema,
  selection: z
    .object({
      start: editorPositionSchema,
      end: editorPositionSchema
    })
    .nullable(),
  scrollTop: z.number().finite().nonnegative()
})

export const attemptSchema = z.object({
  accountKey: z.string().min(1),
  problemId: z.string().regex(/^\d+$/),
  internalProblemId: z.string().regex(/^\d+$/),
  titleSlug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  difficulty: difficultySchema,
  draftCpp: z.string(),
  editorState: persistedEditorStateSchema.nullable(),
  createdAtMs: z.number().int().nonnegative(),
  lastActivityAtMs: z.number().int().nonnegative(),
  lastSavedAtMs: z.number().int().nonnegative()
})

export const recentAttemptSchema = attemptSchema.omit({ draftCpp: true, editorState: true })

export const problemSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(120),
  page: z.number().int().positive().max(100).default(1),
  pageSize: z.number().int().positive().max(50).default(20)
})

export const problemSlugInputSchema = z.object({
  titleSlug: z.string().regex(/^[a-z0-9-]+$/)
})

export const attemptSaveInputSchema = z.object({
  problemId: z.string().regex(/^\d+$/),
  draftCpp: z.string().max(1_000_000),
  editorState: persistedEditorStateSchema.nullable()
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

