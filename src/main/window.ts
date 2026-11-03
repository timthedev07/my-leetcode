import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserWindow } from 'electron'
import { APP_NAME } from '@shared/constants'
import { isApprovedExternalUrl, openExternalUrl } from './security/external-links'

const currentDirectory = fileURLToPath(new URL('.', import.meta.url))

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: APP_NAME,
    backgroundColor: '#101012',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })

  window.once('ready-to-show', () => window.show())

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) void openExternalUrl(url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const developmentUrl = process.env.ELECTRON_RENDERER_URL
    const isCurrentPage = (developmentUrl && url.startsWith(developmentUrl)) || url.startsWith('file://')
    if (!isCurrentPage) {
      event.preventDefault()
      if (isApprovedExternalUrl(url)) void openExternalUrl(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'))
  }

  return window
}

