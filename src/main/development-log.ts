import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

type DevelopmentLogLevel = 'info' | 'warn' | 'error'

let developmentLogPath: string | null = null

export function configureDevelopmentLogging(userDataDirectory: string): void {
  if (!process.env.ELECTRON_RENDERER_URL) return
  developmentLogPath = join(userDataDirectory, 'development.log')
  console.info(`[development] Diagnostics: ${developmentLogPath}`)
}

export function logDevelopmentDiagnostic(
  scope: string,
  message: string,
  details?: Record<string, unknown>,
  level: DevelopmentLogLevel = 'info'
): void {
  if (!process.env.ELECTRON_RENDERER_URL) return

  const record = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...(details ? { details } : {})
  }
  const line = `${JSON.stringify(record)}\n`
  const consoleMethod =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.info
  consoleMethod(`[${scope}] ${message}`, details ?? '')

  if (!developmentLogPath) return
  try {
    mkdirSync(dirname(developmentLogPath), { recursive: true })
    appendFileSync(developmentLogPath, line, 'utf8')
  } catch (error) {
    console.error(
      '[development] Could not write the diagnostic log.',
      error instanceof Error ? error.message : error
    )
  }
}
