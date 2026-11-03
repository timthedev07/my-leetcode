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

export type LeetCodeAuthState = 'disconnected' | 'connecting' | 'connected' | 'expired'

export type LeetCodeAuthStatus = {
  state: LeetCodeAuthState
  username: string | null
  message: string | null
}

export type LeetCodeDifficultyStatistics = {
  difficulty: 'All' | Difficulty
  solved: number
  attempted: number
}

export type UserStatistics = {
  username: string
  ranking: number | null
  realName: string | null
  avatarUrl: string | null
  byDifficulty: LeetCodeDifficultyStatistics[]
}

export type JudgeOperation = 'run' | 'submit'

export type JudgeState =
  | 'requesting'
  | 'queued'
  | 'running'
  | 'passed'
  | 'accepted'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'time_limit'
  | 'other_terminal_error'
  | 'cancelled'
  | 'timed_out'

export type JudgeCaseResult = {
  caseNumber: number
  correct: boolean | null
  statusDisplay: string | null
  input: string | null
  expectedOutput: string | null
  actualOutput: string | null
}

export type JudgeResult = {
  operation: JudgeOperation
  problemSlug: string
  requestId: string
  submissionId: string | null
  state: JudgeState
  statusDisplay: string
  compileError: string | null
  runtimeError: string | null
  totalCorrect: number | null
  totalTestcases: number | null
  runtime: string | null
  memory: string | null
  cases: JudgeCaseResult[]
  codeSnapshot: string
  testInputSnapshot: string | null
  completedAtMs: number
}

export type SubmissionSummary = {
  id: string
  title: string
  titleSlug: string
  status: number | null
  statusDisplay: string
  timestamp: number
  language: string
  languageName: string
  runtime: string | null
  memory: string | null
}

export type SubmissionHistory = {
  submissions: SubmissionSummary[]
  hasNext: boolean
  lastKey: string | null
}

export type SubmissionDetail = SubmissionSummary & {
  code: string
  frontendProblemId: string
}

export type GitHubAuthState = 'disconnected' | 'pending' | 'connected'

export type GitHubAuthStatus = {
  state: GitHubAuthState
  username: string | null
  avatarUrl: string | null
}

export type GitHubDeviceAuthorisation = {
  userCode: string
  verificationUri: string
  expiresInSeconds: number
  intervalSeconds: number
}

export type GitHubRepository = {
  owner: string
  name: string
  fullName: string
  private: boolean
  defaultBranch: string
  canPush: boolean
}

export type GitHubBranch = {
  name: string
}

export type GitHubSyncPreview = {
  sourceSubmissionId: string
  frontendProblemId: string
  path: string
  existingPath: string | null
  identical: boolean
  requiresOverwriteConfirmation: boolean
  problemUrl: string
  sourceCode: string
  existingCode: string | null
  commitMessage: string
}

export type GitHubSyncOutcome = {
  result: 'created' | 'updated' | 'already-synchronised'
  submissionId: string
  path: string
  commitSha: string | null
  fileUrl: string
  commitUrl: string | null
}

export type GitHubSettings = {
  repository: string | null
  branch: string | null
  configured: boolean
}

export type EditorPreferences = {
  vimMode: boolean
}

export type ClangFormatPreset =
  | 'LLVM'
  | 'Google'
  | 'Chromium'
  | 'Microsoft'
  | 'Mozilla'
  | 'WebKit'
  | 'GNU'
  | 'Custom'

export type ClangFormatConfig = {
  yaml: string
}

export type ClangFormatValidation = {
  valid: boolean
  error: string | null
  formattedPreview: string | null
}

export type ClangFormatImportResult = {
  yaml: string
  fileName: string
} | null

export type ClangFormatExportResult = {
  saved: boolean
  fileName: string | null
}

