import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Listener[]>()
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    logger: null as unknown,
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
      return updater
    }),
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    removeAllListeners: () => listeners.clear()
  }
  const app = {
    isPackaged: true,
    name: 'LeetCode Desktop',
    getVersion: vi.fn(() => '1.0.0'),
    quit: vi.fn()
  }
  const window = {
    isDestroyed: vi.fn(() => false),
    setProgressBar: vi.fn()
  }
  const browserWindow = {
    getFocusedWindow: vi.fn(() => window),
    getAllWindows: vi.fn(() => [window])
  }
  const dialog = {
    showMessageBox: vi.fn()
  }
  const menu = {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn()
  }

  return { app, browserWindow, dialog, menu, updater, window }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.browserWindow,
  dialog: mocks.dialog,
  Menu: mocks.menu
}))

vi.mock('electron-updater', () => ({
  autoUpdater: mocks.updater
}))

import { ApplicationUpdater } from '../../src/main/updates'

describe('ApplicationUpdater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updater.removeAllListeners()
    mocks.updater.checkForUpdates.mockReset()
    mocks.updater.downloadUpdate.mockReset()
    mocks.updater.quitAndInstall.mockReset()
    mocks.app.isPackaged = true
    mocks.app.getVersion.mockReturnValue('1.0.0')
    mocks.browserWindow.getFocusedWindow.mockReturnValue(mocks.window)
    mocks.browserWindow.getAllWindows.mockReturnValue([mocks.window])
    mocks.window.isDestroyed.mockReturnValue(false)
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })
  })

  it('configures explicit stable update downloads', () => {
    new ApplicationUpdater()

    expect(mocks.updater.autoDownload).toBe(false)
    expect(mocks.updater.autoInstallOnAppQuit).toBe(true)
    expect(mocks.updater.allowPrerelease).toBe(false)
  })

  it('downloads only after the user accepts the available update', async () => {
    new ApplicationUpdater()

    mocks.updater.emit('update-available', { version: '1.1.0' })

    await vi.waitFor(() => expect(mocks.updater.downloadUpdate).toHaveBeenCalledOnce())
    expect(mocks.dialog.showMessageBox).toHaveBeenCalledWith(
      mocks.window,
      expect.objectContaining({
        message: 'LeetCode Desktop 1.1.0 is available.'
      })
    )
  })

  it('does not download when the user chooses Later', async () => {
    mocks.dialog.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })
    new ApplicationUpdater()

    mocks.updater.emit('update-available', { version: '1.1.0' })

    await vi.waitFor(() => expect(mocks.dialog.showMessageBox).toHaveBeenCalledOnce())
    expect(mocks.updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('requests a normal application quit before installer handoff', async () => {
    const updater = new ApplicationUpdater()

    mocks.updater.emit('update-downloaded', { version: '1.1.0' })

    await vi.waitFor(() => expect(mocks.app.quit).toHaveBeenCalledOnce())
    expect(updater.consumeRestartRequest()).toBe(true)
    expect(updater.consumeRestartRequest()).toBe(false)
    expect(mocks.updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('reports that development builds cannot check for updates', async () => {
    mocks.app.isPackaged = false
    const updater = new ApplicationUpdater()

    await updater.checkForUpdates(true)

    expect(mocks.dialog.showMessageBox).toHaveBeenCalledWith(
      mocks.window,
      expect.objectContaining({
        title: 'Updates unavailable'
      })
    )
  })
})
