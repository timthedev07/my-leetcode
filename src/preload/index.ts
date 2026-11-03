import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, IpcResult, ProblemDetail, ProblemSummary } from '@shared/types'

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
    ipcRenderer.invoke(IPC.leetcodeProblem, { titleSlug })
}

export type DesktopApi = typeof desktopApi

contextBridge.exposeInMainWorld('desktop', desktopApi)

