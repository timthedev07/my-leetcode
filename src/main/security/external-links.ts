import { shell } from 'electron'
import { externalUrlSchema } from '@shared/schemas'

export async function openExternalUrl(value: string): Promise<void> {
  const url = externalUrlSchema.parse(value)
  await shell.openExternal(url)
}

export function isApprovedExternalUrl(value: string): boolean {
  return externalUrlSchema.safeParse(value).success
}

