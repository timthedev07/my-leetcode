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

export type Difficulty = 'Easy' | 'Medium' | 'Hard'

export type TopicTag = {
  name: string
  slug: string
}

export type ProblemSummary = {
  frontendId: string
  title: string
  titleSlug: string
  difficulty: Difficulty
  isPaidOnly: boolean
  topicTags: TopicTag[]
}

export type ProblemDetail = ProblemSummary & {
  internalId: string
  contentHtml: string
  hints: string[]
  starterCode: string
  exampleTestcases: string
}

export type EditorPosition = {
  lineNumber: number
  column: number
}

export type PersistedEditorState = {
  cursor: EditorPosition
  selection: {
    start: EditorPosition
    end: EditorPosition
  } | null
  scrollTop: number
}

export type Attempt = {
  accountKey: string
  problemId: string
  internalProblemId: string
  titleSlug: string
  title: string
  difficulty: Difficulty
  draftCpp: string
  editorState: PersistedEditorState | null
  createdAtMs: number
  lastActivityAtMs: number
  lastSavedAtMs: number
}

export type RecentAttempt = Omit<Attempt, 'draftCpp' | 'editorState'>

export type OpenedAttempt = {
  problem: ProblemDetail
  attempt: Attempt
}

export type RecentAttemptsResult = {
  accountKey: string
  attempts: RecentAttempt[]
}

