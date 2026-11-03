import { ipcMain, type IpcMainEvent } from 'electron'
import type { ZodType } from 'zod'

export function registerValidatedEvent<TInput>(
  channel: string,
  inputSchema: ZodType<TInput>,
  handler: (input: TInput, event: IpcMainEvent) => void
): void {
  ipcMain.on(channel, (event, rawInput: unknown) => {
    if (!isTrustedSender(event)) return

    try {
      handler(inputSchema.parse(rawInput), event)
    } catch (error) {
      const code = error instanceof Error ? error.name : 'UnknownError'
      console.error(`Rejected untrusted ${channel} event (${code}).`)
    }
  })
}

function isTrustedSender(event: IpcMainEvent): boolean {
  const url = event.senderFrame?.url ?? ''
  if (process.env.ELECTRON_RENDERER_URL) return url.startsWith(process.env.ELECTRON_RENDERER_URL)
  return url.startsWith('file://')
}

