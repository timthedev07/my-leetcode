import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { ZodType } from 'zod'
import type { IpcResult } from '@shared/types'
import { toSerialisedError } from './app-error'
import { logDevelopmentDiagnostic } from '../development-log'

export function registerValidatedHandler<TInput, TOutput>(
  channel: string,
  inputSchema: ZodType<TInput>,
  handler: (input: TInput, event: IpcMainInvokeEvent) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, async (event, rawInput: unknown): Promise<IpcResult<TOutput>> => {
    if (!isTrustedSender(event)) {
      return {
        ok: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'The request did not come from the application window.'
        }
      }
    }

    try {
      const input = inputSchema.parse(rawInput)
      return { ok: true, data: await handler(input, event) }
    } catch (error) {
      const serialisedError = toSerialisedError(error)
      logDevelopmentError(channel, serialisedError)
      return { ok: false, error: serialisedError }
    }
  })
}

function logDevelopmentError(
  channel: string,
  error: ReturnType<typeof toSerialisedError>
): void {
  logDevelopmentDiagnostic(
    'ipc',
    `${channel} failed`,
    {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {})
    },
    'error'
  )
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (process.env.ELECTRON_RENDERER_URL) {
    return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  }
  return url.startsWith('file://')
}

