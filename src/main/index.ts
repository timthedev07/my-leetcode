import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  appInfoSchema,
  attemptSaveInputSchema,
  externalUrlSchema,
  problemSearchInputSchema,
  problemSlugInputSchema
} from '@shared/schemas'
import { ATTEMPT_RETENTION_MS } from '@shared/constants'
import type { AppInfo, OpenedAttempt, ProblemDetail, RecentAttemptsResult } from '@shared/types'
import { LeetCodeProblemsService, type ProblemSearchResult } from './leetcode/problems'
import { AttemptStore } from './storage/attempts'
import { installContentSecurityPolicy } from './security/csp'
import { openExternalUrl } from './security/external-links'
import { registerValidatedHandler } from './security/ipc'
import { registerValidatedEvent } from './security/validated-event'
import { createMainWindow } from './window'

app.setName('LeetCode Desktop')

app.whenReady().then(() => {
  installContentSecurityPolicy()
  const problems = new LeetCodeProblemsService()
  const attempts = new AttemptStore(join(app.getPath('userData'), 'leetcode-desktop.sqlite'))
  attempts.deleteExpired(Date.now())
  const retentionTimer = setInterval(() => attempts.deleteExpired(Date.now()), ATTEMPT_RETENTION_MS)
  retentionTimer.unref()

  registerValidatedHandler<undefined, AppInfo>(IPC.appInfo, z.undefined(), () =>
    appInfoSchema.parse({
      version: app.getVersion(),
      platform: process.platform,
      isPackaged: app.isPackaged
    })
  )

  registerValidatedHandler<string, true>(IPC.appOpenExternal, externalUrlSchema, async (url) => {
    await openExternalUrl(url)
    return true as const
  })

  registerValidatedHandler<z.infer<typeof problemSearchInputSchema>, ProblemSearchResult>(
    IPC.leetcodeSearch,
    problemSearchInputSchema,
    async (input) => problems.search(input.query, input.page, input.pageSize)
  )

  registerValidatedHandler<z.infer<typeof problemSlugInputSchema>, ProblemDetail>(
    IPC.leetcodeProblem,
    problemSlugInputSchema,
    async (input) => problems.getProblem(input.titleSlug)
  )

  const getAccountKey = (): string => 'local'

  registerValidatedHandler<z.infer<typeof problemSlugInputSchema>, OpenedAttempt>(
    IPC.attemptOpen,
    problemSlugInputSchema,
    async (input) => {
      const problem = await problems.getProblem(input.titleSlug)
      const attempt = attempts.openAttempt(getAccountKey(), problem, problem.starterCode, Date.now())
      return { problem, attempt }
    }
  )

  registerValidatedHandler<z.infer<typeof attemptSaveInputSchema>, true>(
    IPC.attemptSave,
    attemptSaveInputSchema,
    (input) => {
      attempts.saveAttempt(
        getAccountKey(),
        input.problemId,
        input.draftCpp,
        input.editorState,
        Date.now()
      )
      return true as const
    }
  )

  registerValidatedEvent(IPC.attemptQueueSave, attemptSaveInputSchema, (input) => {
    attempts.saveAttempt(
      getAccountKey(),
      input.problemId,
      input.draftCpp,
      input.editorState,
      Date.now()
    )
  })

  registerValidatedHandler<undefined, RecentAttemptsResult>(IPC.attemptRecent, z.undefined(), () => {
    const accountKey = getAccountKey()
    return {
      accountKey,
      attempts: attempts.listRecent(accountKey, Date.now(), 100)
    }
  })

  createMainWindow()

  app.once('will-quit', () => {
    clearInterval(retentionTimer)
    attempts.close()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

