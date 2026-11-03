import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppInfo, IpcResult } from '@shared/types'

const desktopApi = {
  getAppInfo: (): Promise<IpcResult<AppInfo>> => ipcRenderer.invoke(IPC.appInfo, undefined),
  openExternal: (url: string): Promise<IpcResult<true>> => ipcRenderer.invoke(IPC.appOpenExternal, url)
}

export type DesktopApi = typeof desktopApi

contextBridge.exposeInMainWorld('desktop', desktopApi)

