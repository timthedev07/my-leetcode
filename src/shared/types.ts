export type AppInfo = {
  version: string
  platform: NodeJS.Platform
  isPackaged: boolean
}

export type ErrorCode =
  | 'OFFLINE'
  | 'AUTH_EXPIRED'
  | 'ACCESS_DENIED'
  | 'PREMIUM_LOCKED'
  | 'RATE_LIMITED'
  | 'API_CHANGED'
  | 'JUDGE_FAILED'
  | 'GITHUB_CONFLICT'
  | 'STORAGE_FAILED'
  | 'UNKNOWN'

export type SerialisedError = {
  code: ErrorCode
  message: string
  details?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: SerialisedError }

