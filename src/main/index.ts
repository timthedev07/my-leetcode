import { join } from 'node:path'
import { app, BrowserWindow, clipboard } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import {
  appInfoSchema,
  attemptSaveInputSchema,
  clangFormatConfigSchema,
  clipboardTextSchema,
  editorPreferencesSchema,
  externalUrlSchema,
  githubBranchesInputSchema,
  githubClientIdSchema,
  githubExecuteSyncInputSchema,
  githubPrepareSyncInputSchema,
  githubSettingsSchema,
  judgeCancelInputSchema,
  judgeRunInputSchema,
  judgeSubmitInputSchema,
  leetcodeDisconnectInputSchema,
  problemSearchInputSchema,
  problemSlugInputSchema,
  submissionDetailInputSchema,
  submissionsListInputSchema
} from '@shared/schemas'
import { ATTEMPT_CLEANUP_INTERVAL_MS } from '@shared/constants'
import type {
  AppInfo,
  GitHubAuthStatus,
  GitHubBranch,
  GitHubDeviceAuthorisation,
  GitHubProgressOverview,
  GitHubRepository,
  GitHubSettings,
  GitHubSyncOutcome,
  GitHubSyncPreview,
  ClangFormatConfig,
  ClangFormatExportResult,
  ClangFormatImportResult,
  EditorPreferences,
  JudgeResult,
  LeetCodeAuthStatus,
  OpenedAttempt,
  ProblemDetail,
  RecentAttemptsResult,
  SubmissionDetail,
  SubmissionHistory,
  UserStatistics
} from '@shared/types'
import { LeetCodeAuthService } from './leetcode/auth'
import type { LeetCodeAuthenticatedSession } from './leetcode/auth-contract'
import { LeetCodeJudgeService } from './leetcode/judge'
import { LeetCodeProblemsService, type ProblemSearchResult } from './leetcode/problems'
import { SubmissionService } from './leetcode/submissions'
import { fetchWithTimeout } from './leetcode/transport'
import { GitHubAuthService } from './github/auth'
import { GitHubProgressService, type GitHubDestination } from './github/progress'
import { RepositoryService, type FetchTransport } from './github/repository'
import { GitHubSyncService } from './github/sync'
import { TokenStore } from './github/token-store'
import { ClangFormatConfigStore } from './editor/format-config'
import { AttemptStore } from './storage/attempts'
import { installContentSecurityPolicy } from './security/csp'
import { AppError } from './security/app-error'
import { openExternalUrl } from './security/external-links'
import { registerValidatedHandler } from './security/ipc'
import { registerValidatedEvent } from './security/validated-event'
import { createMainWindow } from './window'
import { configureDevelopmentLogging } from './development-log'
import { ApplicationUpdater, installApplicationMenu } from './updates'

app.setName('LeetCode Desktop')

const hasSingleInstanceLock = !app.isPackaged || app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
})

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return
  installContentSecurityPolicy()
  configureDevelopmentLogging(app.getPath('userData'))
  const updater = new ApplicationUpdater()
  installApplicationMenu(() => {
    void updater.checkForUpdates(true)
  })
  process.env.PLAYWRIGHT_BROWSERS_PATH =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (app.isPackaged
      ? join(process.resourcesPath, 'playwright')
      : join(app.getAppPath(), 'resources', 'playwright'))

  const problems = new LeetCodeProblemsService()
  const attempts = new AttemptStore(join(app.getPath('userData'), 'leetcode-desktop.sqlite'))
  const formatConfigStore = new ClangFormatConfigStore(app.getPath('userData'))
  let accountKey = 'local'
  let judgeService: LeetCodeJudgeService | null = null
  let judgeSession: LeetCodeAuthenticatedSession | null = null

  const leetcodeProfileDirectory = join(app.getPath('userData'), 'leetcode-profile')
  const auth = new LeetCodeAuthService({
    profileDirectory: leetcodeProfileDirectory,
    onStatusChange: (status) => {
      if (status.state === 'connected' && status.username) {
        accountKey = status.username
        attempts.setSetting('leetcode.profileInitialized', '1')
      } else if (status.state === 'expired' || status.state === 'disconnected') {
        accountKey = 'local'
        judgeService = null
        judgeSession = null
      }
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC.leetcodeStatusChanged, status)
      }
    }
  })

  const githubTokenStore = new TokenStore(join(app.getPath('userData'), 'github-token.bin'))
  const githubClientId = async (): Promise<string> => {
    const configured =
      process.env.GITHUB_OAUTH_CLIENT_ID?.trim() ||
      attempts.getSetting('github.oauthClientId')?.trim()
    if (!configured) {
      throw new AppError(
        'ACCESS_DENIED',
        'A public GitHub OAuth client ID is required before GitHub sign-in can begin.',
        'Add it in Settings. Never store a client secret in this application.'
      )
    }
    return configured
  }
  const githubFetch: FetchTransport = (input, init) => fetchWithTimeout(input, init)
  const githubAuth = new GitHubAuthService(githubFetch, githubClientId, githubTokenStore)
  const githubToken = (): Promise<string | null> => githubAuth.getAccessToken()
  const githubRepositories = new RepositoryService(githubToken, githubFetch)
  const getGitHubDestination = async (): Promise<GitHubDestination | null> => {
    const repository = attempts.getSetting('github.repository')
    const branch = attempts.getSetting('github.branch')
    return repository && branch ? { repository, branch } : null
  }
  const githubProgress = new GitHubProgressService({
    getToken: githubToken,
    getSettings: getGitHubDestination,
    fetch: githubFetch
  })
  let githubPendingAuth: Promise<GitHubAuthStatus> | null = null
  let githubAuthAbort: AbortController | null = null
  let githubSyncInFlight = false

  const broadcastGithubStatus = async (): Promise<void> => {
    const status = await githubAuth.getStatus()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.githubStatusChanged, status)
    }
  }

  attempts.deleteExpired(Date.now())
  const retentionTimer = setInterval(() => attempts.deleteExpired(Date.now()), ATTEMPT_CLEANUP_INTERVAL_MS)
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

  registerValidatedHandler<string, true>(IPC.appClipboardWrite, clipboardTextSchema, (text) => {
    clipboard.writeText(text)
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

  const getAccountKey = (): string => accountKey

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

  let resolveQuitFlush: (() => void) | null = null
  registerValidatedEvent(IPC.appFlushComplete, z.undefined(), () => {
    resolveQuitFlush?.()
    resolveQuitFlush = null
  })

  registerValidatedHandler<undefined, RecentAttemptsResult>(IPC.attemptRecent, z.undefined(), () => {
    const accountKey = getAccountKey()
    return {
      accountKey,
      attempts: attempts.listRecent(accountKey, Date.now(), 100)
    }
  })

  registerValidatedHandler<undefined, LeetCodeAuthStatus>(IPC.leetcodeStatus, z.undefined(), () =>
    auth.getStatus()
  )

  registerValidatedHandler<undefined, LeetCodeAuthStatus>(IPC.leetcodeConnect, z.undefined(), async () => {
    const status = await auth.connect()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC.leetcodeStatusChanged, auth.getStatus())
    }
    return status
  })

  registerValidatedHandler<z.infer<typeof leetcodeDisconnectInputSchema>, LeetCodeAuthStatus>(
    IPC.leetcodeDisconnect,
    leetcodeDisconnectInputSchema,
    async (input) => {
      await auth.disconnect(
        input.clearProfile
          ? { deleteProfile: true, profileDeletionConfirmed: true }
          : { deleteProfile: false }
      )
      attempts.setSetting('leetcode.profileInitialized', '0')
      return auth.getStatus()
    }
  )

  registerValidatedHandler<undefined, UserStatistics>(IPC.leetcodeStatistics, z.undefined(), async () => {
    const session = await auth.getAuthenticatedSession()
    return new SubmissionService(session).getCurrentUserStatistics()
  })

  const authenticatedJudge = async (): Promise<LeetCodeJudgeService> => {
    const session = await auth.getAuthenticatedSession()
    if (!judgeService || judgeSession !== session) {
      judgeSession = session
      judgeService = new LeetCodeJudgeService(session)
    }
    return judgeService
  }

  registerValidatedHandler<z.infer<typeof judgeRunInputSchema>, JudgeResult>(
    IPC.judgeRun,
    judgeRunInputSchema,
    async (input) => (await authenticatedJudge()).run(input)
  )

  registerValidatedHandler<z.infer<typeof judgeSubmitInputSchema>, JudgeResult>(
    IPC.judgeSubmit,
    judgeSubmitInputSchema,
    async (input) => (await authenticatedJudge()).submit(input)
  )

  registerValidatedHandler<z.infer<typeof judgeCancelInputSchema>, true>(
    IPC.judgeCancel,
    judgeCancelInputSchema,
    (input) => {
      judgeService?.cancel(input.problemSlug)
      return true as const
    }
  )

  registerValidatedHandler<z.infer<typeof submissionsListInputSchema>, SubmissionHistory>(
    IPC.submissionsList,
    submissionsListInputSchema,
    async (input) => {
      const session = await auth.getAuthenticatedSession()
      return new SubmissionService(session).list(input.problemSlug, {
        offset: input.offset,
        limit: input.limit,
        lastKey: input.lastKey
      })
    }
  )

  registerValidatedHandler<z.infer<typeof submissionDetailInputSchema>, SubmissionDetail>(
    IPC.submissionDetail,
    submissionDetailInputSchema,
    async (input) => {
      const session = await auth.getAuthenticatedSession()
      return new SubmissionService(session).detail(input.submissionId)
    }
  )

  registerValidatedHandler<z.infer<typeof problemSlugInputSchema>, SubmissionDetail | null>(
    IPC.submissionLatestAccepted,
    problemSlugInputSchema,
    async (input) => {
      const session = await auth.getAuthenticatedSession()
      return new SubmissionService(session).findLatestAcceptedCpp(input.titleSlug)
    }
  )

  registerValidatedHandler<undefined, GitHubAuthStatus>(IPC.githubStatus, z.undefined(), async () =>
    githubAuth.getStatus()
  )

  registerValidatedHandler<undefined, GitHubDeviceAuthorisation>(IPC.githubStartAuth, z.undefined(), async () => {
    if (githubPendingAuth || githubAuthAbort) {
      throw new AppError('UNKNOWN', 'GitHub sign-in is already in progress.')
    }
    githubAuthAbort = new AbortController()
    const start = await githubAuth.startDeviceAuthorisation()
    githubPendingAuth = githubAuth
      .pollDeviceAuthorisation(
        start.deviceCode,
        start.intervalSeconds,
        start.expiresInSeconds,
        githubAuthAbort.signal
      )
      .then(async (status) => {
        await broadcastGithubStatus()
        return status
      })
      .finally(() => {
        githubPendingAuth = null
        githubAuthAbort = null
      })
    return {
      userCode: start.userCode,
      verificationUri: start.verificationUri,
      expiresInSeconds: start.expiresInSeconds,
      intervalSeconds: start.intervalSeconds
    }
  })

  registerValidatedHandler<undefined, GitHubAuthStatus>(IPC.githubWaitAuth, z.undefined(), async () => {
    if (!githubPendingAuth) throw new AppError('ACCESS_DENIED', 'GitHub sign-in is not in progress.')
    return githubPendingAuth
  })

  registerValidatedHandler<undefined, true>(IPC.githubCancelAuth, z.undefined(), () => {
    githubAuthAbort?.abort()
    githubAuthAbort = null
    githubPendingAuth = null
    return true as const
  })

  registerValidatedHandler<undefined, GitHubAuthStatus>(IPC.githubDisconnect, z.undefined(), async () => {
    githubAuthAbort?.abort()
    githubAuthAbort = null
    githubPendingAuth = null
    const status = await githubAuth.disconnect()
    await broadcastGithubStatus()
    return status
  })

  registerValidatedHandler<z.infer<typeof githubClientIdSchema>, true>(
    IPC.githubClientId,
    githubClientIdSchema,
    (input) => {
      attempts.setSetting('github.oauthClientId', input.clientId)
      return true as const
    }
  )

  registerValidatedHandler<undefined, string | null>(IPC.githubClientIdStatus, z.undefined(), () =>
    process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || attempts.getSetting('github.oauthClientId')
  )

  registerValidatedHandler<undefined, GitHubRepository[]>(IPC.githubRepositories, z.undefined(), () =>
    githubRepositories.listRepositories()
  )

  registerValidatedHandler<z.infer<typeof githubBranchesInputSchema>, GitHubBranch[]>(
    IPC.githubBranches,
    githubBranchesInputSchema,
    (input) => {
      const [owner, name] = input.repository.split('/')
      if (!owner || !name) throw new Error('Invalid repository.')
      return githubRepositories.listBranches(owner, name)
    }
  )

  registerValidatedHandler<undefined, GitHubSettings>(IPC.githubSettings, z.undefined(), async () => {
    const repository = attempts.getSetting('github.repository')
    const branch = attempts.getSetting('github.branch')
    return {
      repository,
      branch,
      configured: repository !== null && branch !== null
    }
  })

  registerValidatedHandler<z.infer<typeof githubSettingsSchema>, GitHubSettings>(
    IPC.githubSaveSettings,
    githubSettingsSchema,
    async (input) => {
      if (githubSyncInFlight) {
        throw new AppError(
          'GITHUB_CONFLICT',
          'Finish the current GitHub synchronisation before changing the destination.'
        )
      }
      const repository = await githubRepositories.validateDestination(input.repository, input.branch)
      attempts.setSetting('github.repository', repository.fullName)
      attempts.setSetting('github.branch', input.branch)
      return {
        repository: repository.fullName,
        branch: input.branch,
        configured: true
      }
    }
  )

  registerValidatedHandler<undefined, GitHubProgressOverview>(
    IPC.githubProgress,
    z.undefined(),
    () => githubProgress.getOverview()
  )

  const createSyncService = async (): Promise<GitHubSyncService> => {
    const session = await auth.getAuthenticatedSession()
    return new GitHubSyncService({
      getToken: githubToken,
      repositoryService: githubRepositories,
      submissionService: new SubmissionService(session),
      getSettings: getGitHubDestination,
      progressService: githubProgress,
      fetch: githubFetch,
      onSynced: (submissionId, commitSha) => {
        attempts.setSetting('github.lastSyncedSubmissionId', submissionId)
        attempts.setSetting('github.lastSyncedCommitSha', commitSha)
      }
    })
  }

  registerValidatedHandler<z.infer<typeof githubPrepareSyncInputSchema>, GitHubSyncPreview>(
    IPC.githubPrepareSync,
    githubPrepareSyncInputSchema,
    async (input) => (await createSyncService()).prepare(input)
  )

  registerValidatedHandler<z.infer<typeof githubExecuteSyncInputSchema>, GitHubSyncOutcome>(
    IPC.githubExecuteSync,
    githubExecuteSyncInputSchema,
    async (input) => {
      if (githubSyncInFlight) {
        throw new AppError(
          'GITHUB_CONFLICT',
          'A GitHub synchronisation is already in progress.'
        )
      }
      githubSyncInFlight = true
      try {
        const destination = await getGitHubDestination()
        if (
          destination?.repository !== input.expectedRepository ||
          destination.branch !== input.expectedBranch
        ) {
          throw new AppError(
            'GITHUB_CONFLICT',
            'The GitHub destination changed after the preview was prepared.',
            'Review the synchronisation again before committing.'
          )
        }
        return await (await createSyncService()).execute(
          {
            problemSlug: input.problemSlug,
            frontendProblemId: input.frontendProblemId,
            difficulty: input.difficulty
          },
          input.confirmOverwrite,
          input.expectedSubmissionId
        )
      } finally {
        githubSyncInFlight = false
      }
    }
  )

  registerValidatedHandler<undefined, EditorPreferences>(IPC.editorPreferencesGet, z.undefined(), () => ({
    vimMode: attempts.getSetting('editor.vimMode') === 'true'
  }))

  registerValidatedHandler<z.infer<typeof editorPreferencesSchema>, EditorPreferences>(
    IPC.editorPreferencesSet,
    editorPreferencesSchema,
    (input) => {
      attempts.setSetting('editor.vimMode', input.vimMode ? 'true' : 'false')
      return input
    }
  )

  registerValidatedHandler<undefined, ClangFormatConfig>(IPC.clangFormatGet, z.undefined(), () =>
    formatConfigStore.read()
  )

  registerValidatedHandler<z.infer<typeof clangFormatConfigSchema>, ClangFormatConfig>(
    IPC.clangFormatSave,
    clangFormatConfigSchema,
    (input) => formatConfigStore.save(input.yaml)
  )

  registerValidatedHandler<undefined, ClangFormatConfig>(IPC.clangFormatReset, z.undefined(), () =>
    formatConfigStore.reset()
  )

  registerValidatedHandler<undefined, ClangFormatImportResult>(
    IPC.clangFormatImport,
    z.undefined(),
    () => formatConfigStore.importConfig()
  )

  registerValidatedHandler<z.infer<typeof clangFormatConfigSchema>, ClangFormatExportResult>(
    IPC.clangFormatExport,
    clangFormatConfigSchema,
    (input) => formatConfigStore.exportConfig(input.yaml)
  )

  createMainWindow()
  updater.startScheduledChecks()
  if (attempts.getSetting('leetcode.profileInitialized') === '1') {
    void auth.restoreSession().catch(() => {
      // The actionable status is emitted by the auth service.
    })
  }

  let shutdownStarted = false
  let shutdownComplete = false
  app.on('before-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shutdownStarted) return
    shutdownStarted = true
    updater.stopScheduledChecks()
    clearInterval(retentionTimer)

    const windows = BrowserWindow.getAllWindows()
    const flushComplete =
      windows.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resolveQuitFlush = resolve
            for (const window of windows) window.webContents.send(IPC.appPrepareQuit)
          })

    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_500)
      timer.unref()
    })

    void Promise.race([flushComplete, timeout])
      .then(() => auth.dispose())
      .catch((error: unknown) => {
        console.error(`Application shutdown cleanup failed: ${error instanceof Error ? error.name : 'UnknownError'}`)
      })
      .finally(() => {
        const installUpdate = updater.consumeRestartRequest()
        attempts.close()
        shutdownComplete = true
        if (installUpdate) {
          updater.quitAndInstall()
        } else {
          app.quit()
        }
      })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

