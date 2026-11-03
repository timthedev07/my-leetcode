import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  IpcResult,
  OpenedAttempt,
  PersistedEditorState,
  ProblemDetail,
  ProblemSummary,
  RecentAttemptsResult
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
  getRecentAttempts: (): Promise<IpcResult<RecentAttemptsResult>> => ipcRenderer.invoke(IPC.attemptRecent, undefined)
}

export type DesktopApi = typeof desktopApi

contextBridge.exposeInMainWorld('desktop', desktopApi)

