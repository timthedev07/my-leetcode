import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  type MenuItemConstructorOptions,
  type MessageBoxOptions
} from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

const { autoUpdater } = electronUpdater

const INITIAL_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export class ApplicationUpdater {
  private initialCheckTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private checking = false
  private manualCheck = false
  private downloadPromptOpen = false
  private installPromptOpen = false
  private downloading = false
  private downloadedVersion: string | null = null
  private restartRequested = false
  private errorPromptOpen = false

  constructor() {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.logger = {
      info: (message?: unknown) => console.info('[updater]', message),
      warn: (message?: unknown) => console.warn('[updater]', message),
      error: (message?: unknown) => console.error('[updater]', message),
      debug: (message: unknown) => console.debug('[updater]', message)
    }

    autoUpdater.on('update-available', (info) => {
      void this.promptToDownload(info)
    })
    autoUpdater.on('update-not-available', () => {
      if (this.manualCheck) void this.showNoUpdateAvailable()
    })
    autoUpdater.on('download-progress', (progress) => {
      this.setWindowProgress(progress.percent / 100)
    })
    autoUpdater.on('update-downloaded', (event) => {
      this.downloading = false
      this.downloadedVersion = event.version
      this.setWindowProgress(null)
      void this.promptToInstall(event)
    })
    autoUpdater.on('error', (error) => {
      this.downloading = false
      this.setWindowProgress(null)
      this.reportError(error)
    })
  }

  startScheduledChecks(): void {
    if (!app.isPackaged || this.initialCheckTimer || this.intervalTimer) return

    this.initialCheckTimer = setTimeout(() => {
      this.initialCheckTimer = null
      void this.checkForUpdates(false)
    }, INITIAL_CHECK_DELAY_MS)
    this.initialCheckTimer.unref()

    this.intervalTimer = setInterval(() => {
      void this.checkForUpdates(false)
    }, CHECK_INTERVAL_MS)
    this.intervalTimer.unref()
  }

  stopScheduledChecks(): void {
    if (this.initialCheckTimer) clearTimeout(this.initialCheckTimer)
    if (this.intervalTimer) clearInterval(this.intervalTimer)
    this.initialCheckTimer = null
    this.intervalTimer = null
  }

  async checkForUpdates(userInitiated: boolean): Promise<void> {
    if (this.checking || this.downloading) return

    if (!app.isPackaged) {
      if (userInitiated) {
        await this.showMessage({
          type: 'info',
          title: 'Updates unavailable',
          message: 'Update checks are available only in packaged builds.',
          buttons: ['OK'],
          defaultId: 0
        })
      }
      return
    }

    this.checking = true
    this.manualCheck = userInitiated
    try {
      const result = await autoUpdater.checkForUpdates()
      if (userInitiated && result === null) {
        await this.showNoUpdateAvailable()
      }
    } catch (error) {
      this.reportError(toError(error))
    } finally {
      this.checking = false
      this.manualCheck = false
    }
  }

  consumeRestartRequest(): boolean {
    const requested = this.restartRequested
    this.restartRequested = false
    return requested
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall(false, true)
  }

  private async promptToDownload(info: UpdateInfo): Promise<void> {
    if (this.downloadPromptOpen || this.downloading || this.downloadedVersion) return
    this.downloadPromptOpen = true

    try {
      const result = await this.showMessage({
        type: 'info',
        title: 'Update available',
        message: `LeetCode Desktop ${info.version} is available.`,
        detail: `You are using version ${app.getVersion()}. Download the update now?`,
        buttons: ['Download Update', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (result.response !== 0) return

      this.downloading = true
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.downloading = false
      this.setWindowProgress(null)
      this.reportError(toError(error))
    } finally {
      this.downloadPromptOpen = false
    }
  }

  private async promptToInstall(event: UpdateDownloadedEvent): Promise<void> {
    if (this.installPromptOpen) return
    this.installPromptOpen = true

    try {
      const result = await this.showMessage({
        type: 'info',
        title: 'Update ready',
        message: `LeetCode Desktop ${event.version} is ready to install.`,
        detail:
          'Restart now to install the update. If you choose Later, the update will be installed when you next quit the application.',
        buttons: ['Restart and Install', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (result.response !== 0) return

      this.restartRequested = true
      app.quit()
    } finally {
      this.installPromptOpen = false
    }
  }

  private async showNoUpdateAvailable(): Promise<void> {
    await this.showMessage({
      type: 'info',
      title: 'No updates available',
      message: `LeetCode Desktop ${app.getVersion()} is up to date.`,
      buttons: ['OK'],
      defaultId: 0
    })
  }

  private reportError(error: Error): void {
    if (!this.manualCheck && !this.downloading && !this.downloadPromptOpen) return
    if (this.errorPromptOpen) return

    this.errorPromptOpen = true
    const detail = error.message.trim() || error.name || 'Unknown updater error.'
    void this.showMessage({
      type: 'error',
      title: 'Update failed',
      message: 'LeetCode Desktop could not update.',
      detail,
      buttons: ['OK'],
      defaultId: 0
    }).finally(() => {
      this.errorPromptOpen = false
    })
  }

  private showMessage(options: MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
    const focusedWindow = BrowserWindow.getFocusedWindow()
    const window =
      focusedWindow && !focusedWindow.isDestroyed()
        ? focusedWindow
        : BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed())

    return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
  }

  private setWindowProgress(progress: number | null): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.setProgressBar(progress ?? -1)
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function installApplicationMenu(onCheckForUpdates: () => void): void {
  const updateItem: MenuItemConstructorOptions = {
    label: 'Check for Updates...',
    enabled: app.isPackaged,
    click: onCheckForUpdates
  }

  const template: MenuItemConstructorOptions[] = []
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        updateItem,
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push(
    { label: 'File', submenu: [{ role: 'close' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  )

  if (process.platform !== 'darwin') {
    template.push({ role: 'help', submenu: [updateItem] })
  } else {
    template.push({ role: 'help', submenu: [] })
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
