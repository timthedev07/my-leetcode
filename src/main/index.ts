import { app, BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { appInfoSchema, externalUrlSchema, problemSearchInputSchema, problemSlugInputSchema } from '@shared/schemas'
import type { AppInfo, ProblemDetail } from '@shared/types'
import { LeetCodeProblemsService, type ProblemSearchResult } from './leetcode/problems'
import { installContentSecurityPolicy } from './security/csp'
import { openExternalUrl } from './security/external-links'
import { registerValidatedHandler } from './security/ipc'
import { createMainWindow } from './window'

app.setName('LeetCode Desktop')

app.whenReady().then(() => {
  installContentSecurityPolicy()
  const problems = new LeetCodeProblemsService()

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

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

