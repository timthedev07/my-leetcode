import { session } from 'electron'
import { buildContentSecurityPolicy } from './csp-policy'

export function installContentSecurityPolicy(): void {
  const development = Boolean(process.env.ELECTRON_RENDERER_URL)
  const policy = buildContentSecurityPolicy(development)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
}

