import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Braces,
  Check,
  Circle,
  CloudUpload,
  Keyboard,
  Loader2,
  Play,
  RotateCw,
  Send
} from 'lucide-react'
import {
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState
} from 'react'
import type { OpenedAttempt, ProblemDetail, ProblemSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ProblemStatement } from '@/components/problem-statement'
import type { CppEditorHandle } from '@/components/editor/cpp-editor'
import { useDraftPersistence, type SaveStatus } from '@/hooks/use-draft-persistence'
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
}

export function ProblemWorkspace({
  problemSummary,
  onLoaded,
  onFlushReady,
  onSearch
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
    />
  )
}

function LoadedWorkspace({
  opened,
  onFlushReady
}: {
  opened: OpenedAttempt
  onFlushReady: (flush: (() => Promise<void>) | null) => void
}): React.JSX.Element {
  const { problem, attempt } = opened
  const [tabFocusMode, setTabFocusMode] = useStoredState('editor:tab-focus-mode', false)
  const editorRef = useRef<CppEditorHandle>(null)
  const statementRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [editorReady, setEditorReady] = useState(false)
  const [testInput, setTestInput] = useState(problem.exampleTestcases)
  const persistence = useDraftPersistence(attempt, editorRef, () => undefined)
  const flushDraft = persistence.flush

  useEffect(() => {
    onFlushReady(flushDraft)
    return () => onFlushReady(null)
  }, [flushDraft, onFlushReady])

  useEffect(() => {
    const onWorkspaceAction = (event: Event): void => {
      const action = (event as CustomEvent<string>).detail
      if (action === 'description') statementRef.current?.focus()
      else if (action === 'editor') editorRef.current?.focus()
      else if (action === 'panel') panelRef.current?.focus()
      else if (action === 'save') void flushDraft()
    }
    window.addEventListener('leetcode:workspace-action', onWorkspaceAction)
    return () => window.removeEventListener('leetcode:workspace-action', onWorkspaceAction)
  }, [flushDraft])

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
                  draft={persistence.draft}
                  saveStatus={persistence.status}
                  saveError={persistence.errorMessage}
                  tabFocusMode={tabFocusMode}
                  editorReady={editorReady}
                  onReady={() => setEditorReady(true)}
                  onDraftChange={persistence.markDirty}
                  onBlur={() => void persistence.flush()}
                  onToggleTabFocus={() => setTabFocusMode(!tabFocusMode)}
                  onSave={() => void persistence.flush()}
                />
              </Panel>
              <PanelResizeHandle className="workspace-resize-handle workspace-resize-handle-vertical" />
              <Panel defaultSize={34} minSize={20} className="min-w-0">
                <LowerPanel
                  panelRef={panelRef}
                  testInput={testInput}
                  onTestInputChange={setTestInput}
                />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
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
  editorReady,
  onReady,
  onDraftChange,
  onBlur,
  onToggleTabFocus,
  onSave
}: {
  problem: ProblemDetail
  attempt: OpenedAttempt['attempt']
  editorRef: React.RefObject<CppEditorHandle | null>
  draft: string
  saveStatus: SaveStatus
  saveError: string | null
  tabFocusMode: boolean
  editorReady: boolean
  onReady: () => void
  onDraftChange: (value: string) => void
  onBlur: () => void
  onToggleTabFocus: () => void
  onSave: () => void
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
        <div className="ml-auto flex items-center gap-0.5">
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
            onChange={onDraftChange}
            onBlur={onBlur}
            onSave={onSave}
            onReady={onReady}
          />
        </Suspense>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-2 border-t border-border bg-surface/65 px-3">
        <ActionButton
          label="Run"
          keys="⌘↵"
          icon={<Play className="size-3.5" aria-hidden="true" />}
          disabled
          reason="Connect LeetCode to run tests."
        />
        <ActionButton
          label="Submit"
          keys="⌘⇧↵"
          icon={<Send className="size-3.5" aria-hidden="true" />}
          disabled
          reason="Connect LeetCode to submit."
        />
        <div className="ml-auto">
          <ActionButton
            label="Sync to GitHub"
            icon={<CloudUpload className="size-3.5" aria-hidden="true" />}
            disabled
            reason="GitHub sync requires a verified Accepted C++ submission."
          />
        </div>
      </div>
    </section>
  )
}

function LowerPanel({
  panelRef,
  testInput,
  onTestInputChange
}: {
  panelRef: React.RefObject<HTMLDivElement | null>
  testInput: string
  onTestInputChange: (value: string) => void
}): React.JSX.Element {
  return (
    <section ref={panelRef} tabIndex={-1} className="flex h-full min-h-0 flex-col bg-surface/45 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-label="Test and result panel">
      <Tabs defaultValue="tests" className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
          <TabsList className="h-8 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="tests">Test cases</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="submissions">Submissions</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="tests" className="m-0 min-h-0 flex-1 p-3">
          <label className="sr-only" htmlFor="custom-test-input">
            Custom test cases
          </label>
          <textarea
            id="custom-test-input"
            value={testInput}
            onChange={(event) => onTestInputChange(event.target.value)}
            spellCheck={false}
            className="h-full min-h-24 w-full resize-none rounded-md border border-border bg-background/55 p-3 font-mono text-xs leading-5 text-foreground outline-none placeholder:text-muted/60 focus-visible:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/40"
            placeholder="Enter one input per line, using LeetCode’s test-case format."
          />
        </TabsContent>
        <TabsContent value="results" className="m-0 grid min-h-0 flex-1 place-items-center p-5">
          <div className="text-center">
            <Circle className="mx-auto size-4 text-muted/60" aria-hidden="true" />
            <p className="mt-2 text-xs text-muted">Run your C++ solution to see case results.</p>
          </div>
        </TabsContent>
        <TabsContent value="submissions" className="m-0 grid min-h-0 flex-1 place-items-center p-5">
          <div className="text-center">
            <Circle className="mx-auto size-4 text-muted/60" aria-hidden="true" />
            <p className="mt-2 text-xs text-muted">Connect LeetCode to load submission history.</p>
          </div>
        </TabsContent>
      </Tabs>
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
  reason
}: {
  label: string
  keys?: string
  icon: React.ReactNode
  disabled: boolean
  reason: string
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

