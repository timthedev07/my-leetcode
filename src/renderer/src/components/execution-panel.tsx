import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  Circle,
  Clock3,
  Code2,
  Loader2,
  RotateCw,
  Square,
  X
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import type { JudgeResult, JudgeState, SubmissionDetail, SubmissionSummary } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const CppEditor = lazy(() =>
  import('@/components/editor/cpp-editor').then((module) => ({ default: module.CppEditor }))
)

export type ExecutionTab = 'tests' | 'results' | 'submissions'

type ExecutionPanelProps = {
  panelRef: React.RefObject<HTMLDivElement | null>
  tab: ExecutionTab
  onTabChange: (tab: ExecutionTab) => void
  testInput: string
  onTestInputChange: (value: string) => void
  leetcodeConnected: boolean
  problemSlug: string
  judgeResult: JudgeResult | null
  judgeError: string | null
  judgeBusy: 'run' | 'submit' | null
  onCancelJudge: () => void
  onRestoreCode: (code: string) => void
}

export function ExecutionPanel({
  panelRef,
  tab,
  onTabChange,
  testInput,
  onTestInputChange,
  leetcodeConnected,
  problemSlug,
  judgeResult,
  judgeError,
  judgeBusy,
  onCancelJudge,
  onRestoreCode
}: ExecutionPanelProps): React.JSX.Element {
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      className="flex h-full min-h-0 flex-col bg-surface/45 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      aria-label="Tests and submissions"
    >
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as ExecutionTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex h-10 shrink-0 items-center border-b border-border px-2">
          <TabsList className="h-8 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger value="tests">Test cases</TabsTrigger>
            <TabsTrigger value="results">
              Results
              {judgeBusy ? (
                <Loader2 className="ml-1.5 size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : null}
            </TabsTrigger>
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
            placeholder="Enter test inputs using LeetCode’s line-delimited format."
          />
        </TabsContent>

        <TabsContent value="results" className="m-0 min-h-0 flex-1 overflow-y-auto">
          <JudgeResultPanel
            result={judgeResult}
            error={judgeError}
            busy={judgeBusy}
            onCancel={onCancelJudge}
          />
        </TabsContent>

        <TabsContent value="submissions" className="m-0 min-h-0 flex-1 overflow-hidden">
          <SubmissionHistoryPanel
            enabled={tab === 'submissions'}
            connected={leetcodeConnected}
            problemSlug={problemSlug}
            onRestoreCode={onRestoreCode}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}

function JudgeResultPanel({
  result,
  error,
  busy,
  onCancel
}: {
  result: JudgeResult | null
  error: string | null
  busy: 'run' | 'submit' | null
  onCancel: () => void
}): React.JSX.Element {
  if (busy) {
    return (
      <div className="grid h-full min-h-36 place-items-center p-5" aria-live="polite">
        <div className="text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-accent motion-reduce:animate-none" aria-hidden="true" />
          <p className="mt-3 text-sm text-foreground">
            {busy === 'run' ? 'Running custom tests' : 'Submitting to LeetCode'}
          </p>
          <p className="mt-1 text-xs text-muted">LeetCode is processing the snapshot.</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
            <Square className="size-3" aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="grid h-full min-h-36 place-items-center p-5" role="alert">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto size-4 text-destructive" aria-hidden="true" />
          <p className="mt-2 text-sm">Judging failed</p>
          <p className="mt-1 text-xs leading-5 text-muted">{error}</p>
        </div>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="grid h-full min-h-32 place-items-center p-5">
        <div className="text-center">
          <Circle className="mx-auto size-4 text-muted/60" aria-hidden="true" />
          <p className="mt-2 text-xs text-muted">Run your C++ solution to see case results.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 border-b border-border pb-2.5">
        <ResultIcon state={result.state} />
        <div>
          <p className="text-sm font-medium">{resultHeading(result)}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {result.operation === 'run' ? 'Custom test run' : 'Submission'}
            {result.submissionId ? ` · #${result.submissionId}` : ''}
            {result.totalCorrect !== null && result.totalTestcases !== null
              ? ` · ${result.totalCorrect}/${result.totalTestcases} cases`
              : ''}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
          {result.runtime ? (
            <span className="flex items-center gap-1">
              <Clock3 className="size-3" aria-hidden="true" />
              {result.runtime}
            </span>
          ) : null}
          {result.memory ? <span>{result.memory}</span> : null}
        </div>
      </div>

      {result.compileError ? (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-rose-400/90">Compiler output</p>
          <pre className="max-h-48 overflow-auto rounded-md border border-destructive/30 bg-destructive/5 p-3 font-mono text-[11px] leading-5 text-rose-100/85">
            {result.compileError}
          </pre>
        </div>
      ) : null}

      {result.runtimeError ? (
        <p className="mt-3 border-l-2 border-rose-400/60 pl-3 text-xs leading-5 text-rose-200/80">
          {result.runtimeError}
        </p>
      ) : null}

      {result.cases.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {result.cases.map((testCase) => (
            <li key={testCase.caseNumber} className="rounded-md border border-border bg-background/35 p-2.5">
              <div className="flex items-center gap-2">
                {testCase.correct === true ? (
                  <Check className="size-3.5 text-emerald-400" aria-label="Passed" />
                ) : testCase.correct === false ? (
                  <X className="size-3.5 text-rose-400" aria-label="Failed" />
                ) : (
                  <Circle className="size-3 text-muted" aria-hidden="true" />
                )}
                <span className="text-xs">Case {testCase.caseNumber}</span>
                <span className="ml-auto text-[10px] text-muted">{testCase.statusDisplay ?? 'Completed'}</span>
              </div>
              {testCase.actualOutput ? (
                <div className="mt-2 grid gap-1 font-mono text-[10px] leading-4">
                  {testCase.input ? <OutputRow label="Input" value={testCase.input} /> : null}
                  {testCase.expectedOutput ? <OutputRow label="Expected" value={testCase.expectedOutput} /> : null}
                  <OutputRow label="Output" value={testCase.actualOutput} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function SubmissionHistoryPanel({
  enabled,
  connected,
  problemSlug,
  onRestoreCode
}: {
  enabled: boolean
  connected: boolean
  problemSlug: string
  onRestoreCode: (code: string) => void
}): React.JSX.Element {
  const queryClient = useQueryClient()
  const [cppOnly, setCppOnly] = useState(true)
  const [selected, setSelected] = useState<SubmissionSummary | null>(null)
  const history = useQuery({
    queryKey: ['submissions', problemSlug],
    enabled: enabled && connected,
    queryFn: async () => {
      const result = await window.desktop.getSubmissions(problemSlug, 0, 40, null)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  if (!connected) {
    return (
      <div className="grid h-full min-h-32 place-items-center p-5">
        <p className="text-xs text-muted">Connect LeetCode to load submission history.</p>
      </div>
    )
  }

  if (history.isPending) {
    return (
      <div className="grid h-full min-h-32 place-items-center p-5" aria-live="polite">
        <span className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading submissions
        </span>
      </div>
    )
  }

  if (history.isError) {
    return (
      <div className="grid h-full min-h-32 place-items-center p-5" role="alert">
        <div className="text-center">
          <p className="text-xs text-foreground">Submission history unavailable</p>
          <p className="mt-1 text-xs text-muted">{history.error.message}</p>
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void history.refetch()}>
            <RotateCw className="size-3" aria-hidden="true" />
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const submissions = history.data.submissions.filter(
    (submission) => !cppOnly || submission.language.toLowerCase() === 'cpp'
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border px-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-6 px-2 text-[10px]', cppOnly && 'bg-accent/8 text-accent')}
          aria-pressed={cppOnly}
          onClick={() => setCppOnly(!cppOnly)}
        >
          C++ only
        </Button>
        <span className="ml-auto text-[10px] text-muted">{submissions.length} shown</span>
      </div>
      {submissions.length === 0 ? (
        <div className="grid flex-1 place-items-center p-5 text-xs text-muted">No matching submissions.</div>
      ) : (
        <ol className="min-h-0 flex-1 overflow-y-auto">
          {submissions.map((submission) => (
            <li key={submission.id} className="border-b border-border/70">
              <button
                type="button"
                onClick={() => setSelected(submission)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    submission.statusDisplay === 'Accepted' ? 'bg-emerald-400' : 'bg-rose-400/80'
                  )}
                  aria-hidden="true"
                />
                <span className="text-xs">{submission.statusDisplay}</span>
                <span className="text-[10px] text-muted">{submission.languageName}</span>
                <span className="ml-auto text-[10px] text-muted">
                  {new Date(submission.timestamp * 1000).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <SubmissionDialog
        submission={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        onRestored={() => {
          void queryClient.invalidateQueries({ queryKey: ['submissions', problemSlug] })
        }}
        onRestoreCode={onRestoreCode}
      />
    </div>
  )
}

function SubmissionDialog({
  submission,
  open,
  onOpenChange,
  onRestoreCode,
  onRestored
}: {
  submission: SubmissionSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreCode: (code: string) => void
  onRestored: () => void
}): React.JSX.Element {
  const detail = useQuery({
    queryKey: ['submission-detail', submission?.id],
    enabled: open && submission !== null,
    queryFn: async () => {
      if (!submission) throw new Error('No submission was selected.')
      const result = await window.desktop.getSubmissionDetail(submission.id)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Submission #{submission?.id}</DialogTitle>
          <DialogDescription>
            {submission?.statusDisplay ?? 'Loading'} · {submission?.languageName ?? 'C++'}
          </DialogDescription>
        </DialogHeader>
        <div className="h-[52vh] min-h-64 overflow-hidden rounded-md border border-border bg-[#141416]">
          {detail.isPending ? (
            <div className="grid h-full place-items-center text-xs text-muted" aria-live="polite">
              Loading submitted source
            </div>
          ) : detail.isError ? (
            <div className="grid h-full place-items-center p-5 text-center" role="alert">
              <p className="text-xs text-muted">{detail.error.message}</p>
            </div>
          ) : (
            <Suspense fallback={<div className="grid h-full place-items-center text-xs text-muted">Loading editor</div>}>
              <ReadOnlySubmissionCode submission={detail.data} />
            </Suspense>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            disabled={!detail.data}
            onClick={() => {
              if (!detail.data) return
              onRestoreCode(detail.data.code)
              onRestored()
              onOpenChange(false)
            }}
          >
            <Code2 className="size-4" aria-hidden="true" />
            Restore to editor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReadOnlySubmissionCode({ submission }: { submission: SubmissionDetail }): React.JSX.Element {
  return (
    <CppEditor
      modelKey={`submission-${submission.id}`}
      initialValue={submission.code}
      value={submission.code}
      initialState={null}
      tabFocusMode={false}
      vimEnabled={false}
      readOnly
    />
  )
}

function OutputRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[62px_1fr] gap-2">
      <span className="text-muted">{label}</span>
      <span className="whitespace-pre-wrap break-all text-foreground/85">{value}</span>
    </div>
  )
}

function ResultIcon({ state }: { state: JudgeState }): React.JSX.Element {
  if (state === 'accepted' || state === 'passed') return <Check className="size-4 text-emerald-400" aria-hidden="true" />
  if (state === 'cancelled' || state === 'timed_out') return <Clock3 className="size-4 text-amber-400" aria-hidden="true" />
  return <X className="size-4 text-rose-400" aria-hidden="true" />
}

function resultHeading(result: JudgeResult): string {
  if (result.state === 'accepted') return 'Accepted submission'
  if (result.state === 'passed') return 'Custom tests passed'
  if (result.state === 'cancelled') return 'Judging cancelled'
  if (result.state === 'timed_out') return 'Judging timed out'
  return result.statusDisplay
}

