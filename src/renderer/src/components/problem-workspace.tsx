import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlignLeft,
  AlertCircle,
  Braces,
  Check,
  Circle,
  Keyboard,
  Loader2,
  Play,
  RotateCw,
  Send
} from 'lucide-react'
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState
} from 'react'
import type { JudgeResult, OpenedAttempt, ProblemDetail, ProblemSummary } from '@shared/types'
import { ExecutionPanel, type ExecutionTab } from '@/components/execution-panel'
import { GitHubSyncButton } from '@/components/github-sync-button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ProblemStatement } from '@/components/problem-statement'
import type { CppEditorHandle } from '@/components/editor/cpp-editor'
import { useDraftPersistence, type SaveStatus } from '@/hooks/use-draft-persistence'
import { useClangFormatConfig } from '@/hooks/use-clang-format-config'
import { useEditorPreferences } from '@/hooks/use-editor-preferences'
import { useStoredState } from '@/hooks/use-stored-state'
import { cn } from '@/lib/utils'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

const CppEditor = lazy(() =>
  import('@/components/editor/cpp-editor').then((module) => ({ default: module.CppEditor }))
)

type ProblemWorkspaceProps = {
  problemSummary: ProblemSummary
  onLoaded: (attempt: OpenedAttempt) => void
  onFlushReady: (flush: (() => Promise<void>) | null) => void
  onSearch: () => void
  leetcodeConnected: boolean
}

export function ProblemWorkspace({
  problemSummary,
  onLoaded,
  onFlushReady,
  onSearch,
  leetcodeConnected
}: ProblemWorkspaceProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const opened = useQuery({
    queryKey: ['attempt-open', problemSummary.titleSlug],
    queryFn: async () => {
      const result = await window.desktop.openAttempt(problemSummary.titleSlug)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  useEffect(() => {
    if (!opened.data) return
    onLoaded(opened.data)
    void queryClient.invalidateQueries({ queryKey: ['recent-attempts'] })
  }, [onLoaded, opened.data, queryClient])

  if (opened.isPending) {
    return (
      <div className="grid min-h-0 place-items-center text-sm text-muted" aria-live="polite">
        <span className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Preparing workspace
        </span>
      </div>
    )
  }

  if (opened.isError) {
    return (
      <div className="grid min-h-0 place-items-center p-8" role="alert">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto size-5 text-destructive" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-medium">Workspace unavailable</h2>
          <p className="mt-1 text-xs leading-5 text-muted">{opened.error.message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onSearch}>
              Search again
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void opened.refetch()}>
              <RotateCw className="size-3.5" aria-hidden="true" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <LoadedWorkspace
      key={`${opened.data.attempt.accountKey}:${opened.data.attempt.problemId}`}
      opened={opened.data}
      onFlushReady={onFlushReady}
      leetcodeConnected={leetcodeConnected}
    />
  )
}

function LoadedWorkspace({
  opened,
  onFlushReady,
  leetcodeConnected
}: {
  opened: OpenedAttempt
  onFlushReady: (flush: (() => Promise<void>) | null) => void
  leetcodeConnected: boolean
}): React.JSX.Element {
  const { problem, attempt } = opened
  const [tabFocusMode, setTabFocusMode] = useStoredState('editor:tab-focus-mode', false)
  const editorRef = useRef<CppEditorHandle>(null)
  const statementRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [testInput, setTestInput] = useState(problem.exampleTestcases)
  const [executionTab, setExecutionTab] = useState<ExecutionTab>('tests')
  const [judgeResult, setJudgeResult] = useState<JudgeResult | null>(null)
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const [judgeBusy, setJudgeBusy] = useState<'run' | 'submit' | null>(null)
  const [submitConfirmationOpen, setSubmitConfirmationOpen] = useState(false)
  const [pendingRestore, setPendingRestore] = useState<string | null>(null)
  const [formatting, setFormatting] = useState(false)
  const [formatError, setFormatError] = useState<string | null>(null)
  const judgeGeneration = useRef(0)
  const activeJudge = useRef<'run' | 'submit' | null>(null)
  const mounted = useRef(true)
  const persistence = useDraftPersistence(attempt, editorRef, () => undefined)
  const editorPreferences = useEditorPreferences()
  const clangFormatConfig = useClangFormatConfig()
  const flushDraft = persistence.flush
  const currentDraft = persistence.draft

  useEffect(() => {
    mounted.current = true
    onFlushReady(flushDraft)
    return () => {
      mounted.current = false
      onFlushReady(null)
      if (activeJudge.current) void window.desktop.cancelJudge(problem.titleSlug)
    }
  }, [flushDraft, onFlushReady, problem.titleSlug])

  const runCode = useCallback(async (): Promise<void> => {
    if (!leetcodeConnected) {
      setExecutionTab('results')
      setJudgeError('Connect LeetCode before running tests.')
      return
    }
    if (judgeBusy) return
    const generation = ++judgeGeneration.current
    activeJudge.current = 'run'
    setJudgeBusy('run')
    setJudgeError(null)
    setExecutionTab('results')
    await flushDraft()

    const result = await window.desktop.runCode(
      problem.titleSlug,
      problem.internalId,
      currentDraft,
      testInput
    )
    if (generation !== judgeGeneration.current || !mounted.current) return
    activeJudge.current = null
    setJudgeBusy(null)
    if (!result.ok) {
      setJudgeError(result.error.message)
      return
    }
    setJudgeResult(result.data)
  }, [currentDraft, flushDraft, judgeBusy, leetcodeConnected, problem.internalId, problem.titleSlug, testInput])

  const submitCode = useCallback(async (): Promise<void> => {
    if (!leetcodeConnected) {
      setExecutionTab('results')
      setJudgeError('Connect LeetCode before submitting.')
      return
    }
    if (judgeBusy) return
    setSubmitConfirmationOpen(false)
    const generation = ++judgeGeneration.current
    activeJudge.current = 'submit'
    setJudgeBusy('submit')
    setJudgeError(null)
    setExecutionTab('results')
    await flushDraft()

    const result = await window.desktop.submitCode(problem.titleSlug, problem.internalId, currentDraft)
    if (generation !== judgeGeneration.current || !mounted.current) return
    activeJudge.current = null
    setJudgeBusy(null)
    if (!result.ok) {
      setJudgeError(result.error.message)
      return
    }
    setJudgeResult(result.data)
  }, [currentDraft, flushDraft, judgeBusy, leetcodeConnected, problem.internalId, problem.titleSlug])

  const cancelJudge = useCallback((): void => {
    judgeGeneration.current += 1
    void window.desktop.cancelJudge(problem.titleSlug)
    activeJudge.current = null
    setJudgeBusy(null)
  }, [problem.titleSlug])

  const formatDocument = useCallback(async (): Promise<void> => {
    if (formatting || !editorRef.current) return
    if (clangFormatConfig.isLoading) {
      toast.error('The local formatting configuration is still loading.')
      return
    }
    if (clangFormatConfig.error) {
      toast.error(clangFormatConfig.error.message)
      return
    }
    setFormatting(true)
    setFormatError(null)
    try {
      await editorRef.current.formatDocument()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'C++ formatting failed.'
      setFormatError(message)
      toast.error(message)
    } finally {
      if (mounted.current) setFormatting(false)
    }
  }, [clangFormatConfig.error, clangFormatConfig.isLoading, formatting])

  useEffect(() => {
    const onWorkspaceAction = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'description') statementRef.current?.focus()
      else if (action === 'editor') editorRef.current?.focus()
      else if (action === 'panel') panelRef.current?.focus()
      else if (action === 'save') void flushDraft()
      else if (action === 'run') void runCode()
      else if (action === 'submit') setSubmitConfirmationOpen(true)
      else if (action === 'format') void formatDocument()
      else if (action === 'undo') editorRef.current?.undo()
      else if (action === 'redo') editorRef.current?.redo()
    }
    window.addEventListener('leetcode:workspace-action', onWorkspaceAction)
    return () => window.removeEventListener('leetcode:workspace-action', onWorkspaceAction)
  }, [flushDraft, formatDocument, runCode])

  return (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="layout:statement-editor" className="h-full">
          <Panel defaultSize={40} minSize={27} className="min-w-0">
            <ProblemStatement ref={statementRef} problem={problem} />
          </Panel>
          <PanelResizeHandle className="workspace-resize-handle workspace-resize-handle-horizontal" />
          <Panel defaultSize={60} minSize={36} className="min-w-0">
            <PanelGroup direction="vertical" autoSaveId="layout:editor-panel" className="h-full">
              <Panel defaultSize={66} minSize={38} className="min-w-0">
                <EditorPane
                  problem={problem}
                  attempt={attempt}
                  editorRef={editorRef}
                  draft={currentDraft}
                  saveStatus={persistence.status}
                  saveError={persistence.errorMessage}
                  tabFocusMode={tabFocusMode}
                  vimEnabled={editorPreferences.preferences.vimMode}
                  clangFormatYaml={
                    clangFormatConfig.isLoading || clangFormatConfig.error
                      ? null
                      : clangFormatConfig.yaml
                  }
                  vimPreferenceLoading={editorPreferences.isLoading}
                  onVimModeChange={(enabled) => {
                    void editorPreferences.setVimMode(enabled).catch((error: unknown) => {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : 'The editor preference could not be saved.'
                      )
                    })
                  }}
                  formatting={formatting}
                  formatUnavailableReason={
                    clangFormatConfig.isLoading
                      ? 'Loading formatting configuration.'
                      : clangFormatConfig.error?.message ?? null
                  }
                  formatError={formatError}
                  onFormat={() => void formatDocument()}
                  editorReady={editorReady}
                  onReady={() => setEditorReady(true)}
                  onDraftChange={persistence.markDirty}
                  onBlur={() => void persistence.flush()}
                  onToggleTabFocus={() => setTabFocusMode(!tabFocusMode)}
                  onSave={() => void persistence.flush()}
                  onRun={() => void runCode()}
                  onSubmit={() => setSubmitConfirmationOpen(true)}
                  judgeBusy={judgeBusy}
                  leetcodeConnected={leetcodeConnected}
                />
              </Panel>
              <PanelResizeHandle className="workspace-resize-handle workspace-resize-handle-vertical" />
              <Panel defaultSize={34} minSize={20} className="min-w-0">
                <ExecutionPanel
                  panelRef={panelRef}
                  tab={executionTab}
                  onTabChange={setExecutionTab}
                  testInput={testInput}
                  onTestInputChange={setTestInput}
                  leetcodeConnected={leetcodeConnected}
                  problemSlug={problem.titleSlug}
                  judgeResult={judgeResult}
                  judgeError={judgeError}
                  judgeBusy={judgeBusy}
                  onCancelJudge={cancelJudge}
                  onRestoreCode={setPendingRestore}
                />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>

      <AlertDialog open={submitConfirmationOpen} onOpenChange={setSubmitConfirmationOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit this C++ solution to LeetCode?</AlertDialogTitle>
            <AlertDialogDescription>
              Submission is an external action recorded against your LeetCode account. The current editor snapshot will be
              judged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submitCode()}>Submit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingRestore !== null} onOpenChange={(open) => !open && setPendingRestore(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace the current draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Restoring this submission replaces the editor text. The replaced draft will be overwritten after autosave.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRestore !== null) persistence.markDirty(pendingRestore)
                setPendingRestore(null)
              }}
            >
              Restore submission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function EditorPane({
  problem,
  attempt,
  editorRef,
  draft,
  saveStatus,
  saveError,
  tabFocusMode,
  vimEnabled,
  clangFormatYaml,
  vimPreferenceLoading,
  onVimModeChange,
  formatting,
  formatUnavailableReason,
  formatError,
  onFormat,
  editorReady,
  onReady,
  onDraftChange,
  onBlur,
  onToggleTabFocus,
  onSave,
  onRun,
  onSubmit,
  judgeBusy,
  leetcodeConnected
}: {
  problem: ProblemDetail
  attempt: OpenedAttempt['attempt']
  editorRef: React.RefObject<CppEditorHandle | null>
  draft: string
  saveStatus: SaveStatus
  saveError: string | null
  tabFocusMode: boolean
  vimEnabled: boolean
  clangFormatYaml: string | null
  vimPreferenceLoading: boolean
  onVimModeChange: (enabled: boolean) => void
  formatting: boolean
  formatUnavailableReason: string | null
  formatError: string | null
  onFormat: () => void
  editorReady: boolean
  onReady: () => void
  onDraftChange: (value: string) => void
  onBlur: () => void
  onToggleTabFocus: () => void
  onSave: () => void
  onRun: () => void
  onSubmit: () => void
  judgeBusy: 'run' | 'submit' | null
  leetcodeConnected: boolean
}): React.JSX.Element {
  return (
    <section className="flex h-full min-h-0 flex-col bg-[#141416]" aria-label="C++ editor">
      <div className="flex h-10 shrink-0 items-center border-b border-border bg-surface/70 px-3">
        <Braces className="size-3.5 text-accent/80" aria-hidden="true" />
        <span className="ml-2 font-mono text-[11px] text-foreground">
          Problem{problem.frontendId}.cpp
        </span>
        <span className="ml-2 text-[10px] text-muted">C++</span>
        <SaveIndicator status={saveStatus} error={saveError} />
        <div
          className="ml-3 flex items-center rounded border border-border bg-background/45 p-0.5"
          role="group"
          aria-label="Editor keybindings"
        >
          <button
            type="button"
            className={cn(
              'h-6 rounded-[3px] px-2 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !vimEnabled ? 'bg-surface-hover text-foreground' : 'text-muted hover:text-foreground'
            )}
            aria-pressed={!vimEnabled}
            disabled={vimPreferenceLoading}
            onClick={() => {
              if (vimEnabled) onVimModeChange(false)
            }}
          >
            Standard
          </button>
          <button
            type="button"
            className={cn(
              'h-6 rounded-[3px] px-2 font-mono text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              vimEnabled ? 'bg-accent/15 text-accent' : 'text-muted hover:text-foreground'
            )}
            aria-pressed={vimEnabled}
            disabled={vimPreferenceLoading}
            onClick={() => {
              if (!vimEnabled) onVimModeChange(true)
            }}
          >
            Vim
          </button>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={onFormat}
                disabled={formatting || formatUnavailableReason !== null}
                aria-label="Format C++ document"
              >
                {formatting ? (
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <AlignLeft className="size-3.5" aria-hidden="true" />
                )}
                Format
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {formatUnavailableReason ?? formatError ?? 'Format C++ document (⌥⇧F)'}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('size-7', tabFocusMode && 'bg-accent/10 text-accent')}
                aria-label={tabFocusMode ? 'Disable Tab moves focus' : 'Enable Tab moves focus'}
                aria-pressed={tabFocusMode}
                onClick={onToggleTabFocus}
              >
                <Keyboard className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tab moves focus</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={onSave}>
            Save
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {!editorReady ? (
          <div className="grid h-full place-items-center text-xs text-muted" aria-live="polite">
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              Loading editor
            </span>
          </div>
        ) : null}
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-xs text-muted" aria-live="polite">
              Loading editor
            </div>
          }
        >
          <CppEditor
            ref={editorRef}
            modelKey={attempt.problemId}
            initialValue={attempt.draftCpp}
            value={draft}
            initialState={attempt.editorState}
            tabFocusMode={tabFocusMode}
            vimEnabled={vimEnabled}
            clangFormatYaml={clangFormatYaml}
            onChange={onDraftChange}
            onBlur={onBlur}
            onSave={onSave}
            onRun={onRun}
            onSubmit={onSubmit}
            onReady={onReady}
          />
        </Suspense>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border bg-surface/65 px-3">
        <ActionButton
          label="Run"
          keys="⌘↵"
          icon={<Play className="size-3.5" aria-hidden="true" />}
          disabled={!leetcodeConnected || judgeBusy !== null}
          reason={leetcodeConnected ? 'Run the current editor snapshot against the custom test input.' : 'Connect LeetCode to run tests.'}
          onClick={onRun}
        />
        <ActionButton
          label="Submit"
          keys="⌘⇧↵"
          icon={<Send className="size-3.5" aria-hidden="true" />}
          disabled={!leetcodeConnected || judgeBusy !== null}
          reason={leetcodeConnected ? 'Submit the current editor snapshot to LeetCode.' : 'Connect LeetCode to submit.'}
          onClick={onSubmit}
        />
        <div className="ml-auto">
          <GitHubSyncButton problem={problem} leetcodeConnected={leetcodeConnected} />
        </div>
      </div>
    </section>
  )
}

function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }): React.JSX.Element {
  const content = (
    <span className="ml-3 flex items-center gap-1 text-[10px] text-muted" aria-live="polite">
      {status === 'saved' ? (
        <>
          <Check className="size-3 text-emerald-400/80" aria-hidden="true" />
          Saved
        </>
      ) : status === 'saving' ? (
        <>
          <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Saving
        </>
      ) : status === 'error' ? (
        <>
          <AlertCircle className="size-3 text-destructive" aria-hidden="true" />
          Save failed
        </>
      ) : (
        <>
          <Circle className="size-2 fill-amber-400/80 text-amber-400/80" aria-hidden="true" />
          Unsaved
        </>
      )}
    </span>
  )

  return error ? (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>{error}</TooltipContent>
    </Tooltip>
  ) : (
    content
  )
}

function ActionButton({
  label,
  keys,
  icon,
  disabled,
  reason,
  onClick
}: {
  label: string
  keys?: string
  icon: React.ReactNode
  disabled: boolean
  reason: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-disabled={disabled}
          className={cn(disabled && 'cursor-not-allowed opacity-45')}
          onClick={(event) => {
            if (disabled) event.preventDefault()
            else onClick()
          }}
        >
          {icon}
          {label}
          {keys ? <span className="ml-1 text-[9px] text-muted">{keys}</span> : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

