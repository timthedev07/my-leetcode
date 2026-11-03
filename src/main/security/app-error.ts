import type { ErrorCode, SerialisedError } from '@shared/types'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly details?: string

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    if (details !== undefined) this.details = details
  }

  toJSON(): SerialisedError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {})
    }
  }
}

export function toSerialisedError(error: unknown): SerialisedError {
  if (error instanceof AppError) return error.toJSON()

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return {
      code: 'OFFLINE',
      message: 'The network is unavailable. Check your connection and try again.'
    }
  }

  return {
    code: 'UNKNOWN',
    message: 'An unexpected error occurred.',
    ...(error instanceof Error ? { details: error.message } : {})
  }
}

