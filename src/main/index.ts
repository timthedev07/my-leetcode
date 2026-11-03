import { app, BrowserWindow } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { appInfoSchema, externalUrlSchema } from '@shared/schemas'
import type { AppInfo } from '@shared/types'
import { installContentSecurityPolicy } from './security/csp'
import { openExternalUrl } from './security/external-links'
import { registerValidatedHandler } from './security/ipc'
import { createMainWindow } from './window'

app.setName('LeetCode Desktop')

app.whenReady().then(() => {
  installContentSecurityPolicy()

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

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

