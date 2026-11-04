import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  ClangFormatConfig,
  ClangFormatExportResult,
  ClangFormatImportResult,
  EditorPreferences,
  GitHubAuthStatus,
  GitHubBranch,
  GitHubDeviceAuthorisation,
  GitHubProgressOverview,
  GitHubRepository,
  GitHubSettings,
  GitHubSyncOutcome,
  GitHubSyncPreview,
  IpcResult,
  JudgeResult,
  LeetCodeAuthStatus,
  OpenedAttempt,
  PersistedEditorState,
  ProblemDetail,
  ProblemSummary,
  RecentAttemptsResult,
  SubmissionDetail,
  SubmissionHistory,
  UserStatistics
} from '@shared/types'

type ProblemSearchResult = {
  problems: ProblemSummary[]
  total: number
  page: number
  pageSize: number
}

const desktopApi = {
  getAppInfo: (): Promise<IpcResult<AppInfo>> => ipcRenderer.invoke(IPC.appInfo, undefined),
  openExternal: (url: string): Promise<IpcResult<true>> => ipcRenderer.invoke(IPC.appOpenExternal, url),
  copyText: (text: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IPC.appClipboardWrite, text),
  onPrepareQuit: (listener: () => void | Promise<void>): (() => void) => {
    const onPrepare = (): void => {
      void listener()
    }
    ipcRenderer.on(IPC.appPrepareQuit, onPrepare)
    return () => ipcRenderer.removeListener(IPC.appPrepareQuit, onPrepare)
  },
  completeQuitFlush: (): void => ipcRenderer.send(IPC.appFlushComplete, undefined),
  searchProblems: (query: string, page = 1, pageSize = 20): Promise<IpcResult<ProblemSearchResult>> =>
    ipcRenderer.invoke(IPC.leetcodeSearch, { query, page, pageSize }),
  getProblem: (titleSlug: string): Promise<IpcResult<ProblemDetail>> =>
    ipcRenderer.invoke(IPC.leetcodeProblem, { titleSlug }),
  openAttempt: (titleSlug: string): Promise<IpcResult<OpenedAttempt>> =>
    ipcRenderer.invoke(IPC.attemptOpen, { titleSlug }),
  saveAttempt: (
    problemId: string,
    draftCpp: string,
    editorState: PersistedEditorState | null
  ): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IPC.attemptSave, { problemId, draftCpp, editorState }),
  queueAttemptSave: (problemId: string, draftCpp: string, editorState: PersistedEditorState | null): void =>
    ipcRenderer.send(IPC.attemptQueueSave, { problemId, draftCpp, editorState }),
  getRecentAttempts: (): Promise<IpcResult<RecentAttemptsResult>> => ipcRenderer.invoke(IPC.attemptRecent, undefined),
  getLeetCodeStatus: (): Promise<IpcResult<LeetCodeAuthStatus>> => ipcRenderer.invoke(IPC.leetcodeStatus, undefined),
  connectLeetCode: (): Promise<IpcResult<LeetCodeAuthStatus>> => ipcRenderer.invoke(IPC.leetcodeConnect, undefined),
  disconnectLeetCode: (clearProfile: boolean): Promise<IpcResult<LeetCodeAuthStatus>> =>
    ipcRenderer.invoke(IPC.leetcodeDisconnect, { clearProfile }),
  onLeetCodeStatus: (listener: (status: LeetCodeAuthStatus) => void): (() => void) => {
    const onStatus = (_event: Electron.IpcRendererEvent, status: LeetCodeAuthStatus): void => listener(status)
    ipcRenderer.on(IPC.leetcodeStatusChanged, onStatus)
    return () => ipcRenderer.removeListener(IPC.leetcodeStatusChanged, onStatus)
  },
  getLeetCodeStatistics: (): Promise<IpcResult<UserStatistics>> => ipcRenderer.invoke(IPC.leetcodeStatistics, undefined),
  runCode: (
    problemSlug: string,
    internalProblemId: string,
    typedCode: string,
    dataInput: string
  ): Promise<IpcResult<JudgeResult>> =>
    ipcRenderer.invoke(IPC.judgeRun, { problemSlug, internalProblemId, typedCode, dataInput }),
  submitCode: (
    problemSlug: string,
    internalProblemId: string,
    typedCode: string
  ): Promise<IpcResult<JudgeResult>> =>
    ipcRenderer.invoke(IPC.judgeSubmit, { problemSlug, internalProblemId, typedCode }),
  cancelJudge: (problemSlug: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IPC.judgeCancel, { problemSlug }),
  getSubmissions: (
    problemSlug: string,
    offset = 0,
    limit = 20,
    lastKey: string | null = null
  ): Promise<IpcResult<SubmissionHistory>> =>
    ipcRenderer.invoke(IPC.submissionsList, { problemSlug, offset, limit, lastKey }),
  getSubmissionDetail: (submissionId: string): Promise<IpcResult<SubmissionDetail>> =>
    ipcRenderer.invoke(IPC.submissionDetail, { submissionId }),
  getLatestAcceptedCpp: (problemSlug: string): Promise<IpcResult<SubmissionDetail | null>> =>
    ipcRenderer.invoke(IPC.submissionLatestAccepted, { titleSlug: problemSlug }),
  getGitHubStatus: (): Promise<IpcResult<GitHubAuthStatus>> => ipcRenderer.invoke(IPC.githubStatus, undefined),
  startGitHubAuth: (): Promise<IpcResult<GitHubDeviceAuthorisation>> =>
    ipcRenderer.invoke(IPC.githubStartAuth, undefined),
  waitForGitHubAuth: (): Promise<IpcResult<GitHubAuthStatus>> =>
    ipcRenderer.invoke(IPC.githubWaitAuth, undefined),
  cancelGitHubAuth: (): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IPC.githubCancelAuth, undefined),
  onGitHubStatus: (listener: (status: GitHubAuthStatus) => void): (() => void) => {
    const onStatus = (_event: Electron.IpcRendererEvent, status: GitHubAuthStatus): void => listener(status)
    ipcRenderer.on(IPC.githubStatusChanged, onStatus)
    return () => ipcRenderer.removeListener(IPC.githubStatusChanged, onStatus)
  },
  disconnectGitHub: (): Promise<IpcResult<GitHubAuthStatus>> =>
    ipcRenderer.invoke(IPC.githubDisconnect, undefined),
  setGitHubClientId: (clientId: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(IPC.githubClientId, { clientId }),
  getGitHubClientId: (): Promise<IpcResult<string | null>> =>
    ipcRenderer.invoke(IPC.githubClientIdStatus, undefined),
  getGitHubRepositories: (): Promise<IpcResult<GitHubRepository[]>> =>
    ipcRenderer.invoke(IPC.githubRepositories, undefined),
  getGitHubBranches: (repository: string): Promise<IpcResult<GitHubBranch[]>> =>
    ipcRenderer.invoke(IPC.githubBranches, { repository }),
  getGitHubSettings: (): Promise<IpcResult<GitHubSettings>> =>
    ipcRenderer.invoke(IPC.githubSettings, undefined),
  saveGitHubSettings: (repository: string, branch: string): Promise<IpcResult<GitHubSettings>> =>
    ipcRenderer.invoke(IPC.githubSaveSettings, { repository, branch }),
  getGitHubProgress: (): Promise<IpcResult<GitHubProgressOverview>> =>
    ipcRenderer.invoke(IPC.githubProgress, undefined),
  prepareGitHubSync: (
    problemSlug: string,
    frontendProblemId: string,
    difficulty: 'Easy' | 'Medium' | 'Hard'
  ): Promise<IpcResult<GitHubSyncPreview>> =>
    ipcRenderer.invoke(IPC.githubPrepareSync, { problemSlug, frontendProblemId, difficulty }),
  executeGitHubSync: (
    problemSlug: string,
    frontendProblemId: string,
    difficulty: 'Easy' | 'Medium' | 'Hard',
    confirmOverwrite: boolean,
    expectedSubmissionId: string,
    expectedRepository: string,
    expectedBranch: string
  ): Promise<IpcResult<GitHubSyncOutcome>> =>
    ipcRenderer.invoke(IPC.githubExecuteSync, {
      problemSlug,
      frontendProblemId,
      difficulty,
      confirmOverwrite,
      expectedSubmissionId,
      expectedRepository,
      expectedBranch
    }),
  getEditorPreferences: (): Promise<IpcResult<EditorPreferences>> =>
    ipcRenderer.invoke(IPC.editorPreferencesGet, undefined),
  setEditorPreferences: (preferences: EditorPreferences): Promise<IpcResult<EditorPreferences>> =>
    ipcRenderer.invoke(IPC.editorPreferencesSet, preferences),
  getClangFormatConfig: (): Promise<IpcResult<ClangFormatConfig>> =>
    ipcRenderer.invoke(IPC.clangFormatGet, undefined),
  saveClangFormatConfig: (yaml: string): Promise<IpcResult<ClangFormatConfig>> =>
    ipcRenderer.invoke(IPC.clangFormatSave, { yaml }),
  resetClangFormatConfig: (): Promise<IpcResult<ClangFormatConfig>> =>
    ipcRenderer.invoke(IPC.clangFormatReset, undefined),
  importClangFormatConfig: (): Promise<IpcResult<ClangFormatImportResult>> =>
    ipcRenderer.invoke(IPC.clangFormatImport, undefined),
  exportClangFormatConfig: (yaml: string): Promise<IpcResult<ClangFormatExportResult>> =>
    ipcRenderer.invoke(IPC.clangFormatExport, { yaml })
}

export type DesktopApi = typeof desktopApi

contextBridge.exposeInMainWorld('desktop', desktopApi)

