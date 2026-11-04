import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CloudUpload, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { GitHubSyncOutcome, GitHubSyncPreview, ProblemDetail } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useGitHubAuth } from '@/hooks/use-github-auth'

type GitHubSyncButtonProps = {
  problem: ProblemDetail
  leetcodeConnected: boolean
}

export function GitHubSyncButton({
  problem,
  leetcodeConnected
}: GitHubSyncButtonProps): React.JSX.Element {
  const github = useGitHubAuth()
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<GitHubSyncPreview | null>(null)
  const [outcome, setOutcome] = useState<GitHubSyncOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['github-settings'],
    enabled: github.state === 'connected',
    queryFn: async () => {
      const result = await window.desktop.getGitHubSettings()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  const progress = useQuery({
    queryKey: [
      'github-progress',
      settings.data?.repository,
      settings.data?.branch
    ],
    enabled:
      github.state === 'connected' &&
      settings.data?.configured === true &&
      Boolean(settings.data.repository && settings.data.branch),
    queryFn: async () => {
      const result = await window.desktop.getGitHubProgress()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  const accepted = useQuery({
    queryKey: ['latest-accepted-cpp', problem.titleSlug],
    enabled:
      leetcodeConnected &&
      github.state === 'connected' &&
      settings.data?.configured === true,
    queryFn: async () => {
      const result = await window.desktop.getLatestAcceptedCpp(problem.titleSlug)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  const disabledReason = !leetcodeConnected
    ? 'Connect LeetCode to identify an Accepted C++ submission.'
    : github.state !== 'connected'
      ? 'Connect GitHub in Settings.'
      : !settings.data?.configured
        ? 'Confirm a GitHub repository and branch in Settings.'
        : progress.isPending
          ? 'Validating repository progress data.'
          : progress.error
            ? progress.error.message
            : accepted.isPending || accepted.isFetching
              ? 'Checking LeetCode for the latest Accepted C++ submission.'
              : accepted.error
                ? accepted.error.message
                : !accepted.data
                  ? 'No server-recorded Accepted C++ submission exists for this problem.'
                  : null

  const prepare = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.prepareGitHubSync(
        problem.titleSlug,
        problem.frontendId,
        problem.difficulty
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onMutate: () => setError(null),
    onSuccess: (nextPreview) => {
      setPreview(nextPreview)
      setOutcome(null)
      setError(null)
    },
    onError: (mutationError) => {
      setError(mutationError.message)
      toast.error(mutationError.message)
    }
  })

  const execute = useMutation({
    mutationFn: async (syncPreview: GitHubSyncPreview) => {
      const result = await window.desktop.executeGitHubSync(
        problem.titleSlug,
        problem.frontendId,
        problem.difficulty,
        syncPreview.requiresOverwriteConfirmation,
        syncPreview.sourceSubmissionId,
        syncPreview.repository,
        syncPreview.branch
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (syncOutcome) => {
      setOutcome(syncOutcome)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['github-progress'] })
      void queryClient.invalidateQueries({ queryKey: ['github-settings'] })
      void queryClient.invalidateQueries({
        queryKey: ['latest-accepted-cpp', problem.titleSlug]
      })
      toast.success(successMessage(syncOutcome))
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const disabled = disabledReason !== null
  const canExecute =
    preview !== null &&
    preview.changedFiles.length > 0 &&
    !execute.isPending

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="secondary"
            size="sm"
            aria-disabled={disabled}
            className={disabled ? 'cursor-not-allowed opacity-45' : undefined}
            onClick={() => {
              if (!disabled && !prepare.isPending) prepare.mutate()
            }}
          >
            {prepare.isPending || execute.isPending ? (
              <Loader2
                className="size-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <CloudUpload className="size-3.5" aria-hidden="true" />
            )}
            Sync to GitHub
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {disabledReason ?? `Latest Accepted C++ submission #${accepted.data?.id}`}
        </TooltipContent>
      </Tooltip>

      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPreview(null)
            setOutcome(null)
            setError(null)
          }
        }}
      >
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {outcome ? 'GitHub synchronisation complete' : 'Review GitHub synchronisation'}
            </DialogTitle>
            <DialogDescription>
              {outcome
                ? successMessage(outcome)
                : `One commit will update the accepted solution record and ${'data/progress.json'}.`}
            </DialogDescription>
          </DialogHeader>

          {outcome ? (
            <OutcomeView outcome={outcome} />
          ) : preview ? (
            <PreviewView preview={preview} />
          ) : null}

          {error ? (
            <p className="text-xs leading-5 text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setPreview(null)
                setOutcome(null)
                setError(null)
              }}
            >
              Close
            </Button>
            {!outcome && preview ? (
              <Button
                onClick={() => execute.mutate(preview)}
                disabled={!canExecute}
              >
                {execute.isPending ? (
                  <Loader2
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : preview.requiresOverwriteConfirmation ? (
                  <TriangleAlert className="size-4" aria-hidden="true" />
                ) : (
                  <CloudUpload className="size-4" aria-hidden="true" />
                )}
                {actionLabel(preview)}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PreviewView({ preview }: { preview: GitHubSyncPreview }): React.JSX.Element {
  return (
    <>
      <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 border-y border-border py-4 text-xs">
        <dt className="text-muted">Problem</dt>
        <dd className="text-foreground">
          {preview.frontendProblemId}. {preview.problemName}
        </dd>
        <dt className="text-muted">Accepted submission</dt>
        <dd className="font-mono text-foreground">#{preview.sourceSubmissionId}</dd>
        <dt className="text-muted">Destination</dt>
        <dd className="font-mono text-foreground">
          {preview.repository} · {preview.branch}
        </dd>
        <dt className="text-muted">Solution file</dt>
        <dd className="font-mono text-foreground">
          {preview.path} · {solutionActionLabel(preview.solutionAction)}
        </dd>
        <dt className="text-muted">Completion</dt>
        <dd className="text-foreground">
          {preview.previousDone ? 'Complete' : 'Incomplete'} → Complete
        </dd>
        <dt className="text-muted">Learning order</dt>
        <dd className="text-foreground">
          {preview.curated
            ? `Curated · Phase ${preview.phase} · Order ${preview.order}`
            : 'Additional problem outside the curated 500'}
        </dd>
        <dt className="text-muted">Progress update</dt>
        <dd className="text-foreground">{progressActionLabel(preview.progressAction)}</dd>
        <dt className="text-muted">Files changed</dt>
        <dd className="font-mono text-foreground">
          {preview.changedFiles.length ? preview.changedFiles.join(', ') : 'None'}
        </dd>
      </dl>

      {preview.requiresOverwriteConfirmation ? (
        <div className="flex items-start gap-2.5 border-l-2 border-amber-400/70 pl-3 text-xs leading-5 text-amber-100/85">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            The destination contains different C++ code. Continuing replaces that file in the
            same atomic commit as the progress update.
          </p>
        </div>
      ) : null}

      <div className="grid min-h-0 grid-cols-2 gap-3">
        <CodePreview title="Accepted source" code={preview.sourceCode} />
        <CodePreview
          title={preview.existingCode ? 'Current remote file' : 'Remote file'}
          code={preview.existingCode ?? 'No existing file.'}
        />
      </div>
    </>
  )
}

function OutcomeView({ outcome }: { outcome: GitHubSyncOutcome }): React.JSX.Element {
  return (
    <div className="border-y border-border py-5">
      <div className="flex items-center gap-2">
        <Check className="size-4 text-emerald-400" aria-hidden="true" />
        <p className="text-sm">{successMessage(outcome)}</p>
      </div>
      <dl className="mt-4 grid grid-cols-[130px_1fr] gap-x-3 gap-y-2 text-xs">
        <dt className="text-muted">Submission</dt>
        <dd className="font-mono text-foreground">#{outcome.submissionId}</dd>
        <dt className="text-muted">Solution file</dt>
        <dd className="font-mono text-foreground">
          {outcome.path} · {solutionActionLabel(outcome.solutionAction)}
        </dd>
        <dt className="text-muted">Progress</dt>
        <dd className="text-foreground">{progressActionLabel(outcome.progressAction)}</dd>
        <dt className="text-muted">Changed files</dt>
        <dd className="font-mono text-foreground">
          {outcome.changedFiles.length ? outcome.changedFiles.join(', ') : 'None'}
        </dd>
        <dt className="text-muted">README workflow</dt>
        <dd className="text-foreground">{readmeStatusLabel(outcome.readmeStatus)}</dd>
        {outcome.commitSha ? (
          <>
            <dt className="text-muted">Commit</dt>
            <dd className="break-all font-mono text-foreground">{outcome.commitSha}</dd>
          </>
        ) : null}
      </dl>
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void window.desktop.openExternal(outcome.fileUrl)}
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open solution
        </Button>
        {outcome.commitUrl ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void window.desktop.openExternal(outcome.commitUrl!)}
          >
            Open commit
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function CodePreview({ title, code }: { title: string; code: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[11px] text-muted">{title}</p>
      <pre className="max-h-[42vh] overflow-auto rounded-md border border-border bg-[#141416] p-3 font-mono text-[11px] leading-5 text-foreground/85">
        {code}
      </pre>
    </div>
  )
}

function actionLabel(preview: GitHubSyncPreview): string {
  if (preview.changedFiles.length === 0) return 'Already synchronised'
  if (preview.solutionAction === 'unchanged') return 'Repair progress'
  if (preview.solutionAction === 'update') return 'Overwrite and synchronise'
  return 'Create solution and progress'
}

function successMessage(outcome: GitHubSyncOutcome): string {
  if (outcome.result === 'already-synchronised') return 'Solution and progress are already synchronised.'
  if (outcome.solutionAction === 'unchanged') return 'Progress metadata repaired without changing the solution.'
  if (outcome.solutionAction === 'update') return 'Accepted C++ solution and progress updated atomically.'
  return 'Accepted C++ solution and progress created atomically.'
}

function solutionActionLabel(action: GitHubSyncPreview['solutionAction']): string {
  return action === 'create' ? 'Create' : action === 'update' ? 'Update' : 'Unchanged'
}

function progressActionLabel(action: GitHubSyncPreview['progressAction']): string {
  return action === 'add'
    ? 'Add as an additional problem'
    : action === 'update'
      ? 'Mark complete and update solution path'
      : 'No metadata change'
}

function readmeStatusLabel(status: GitHubSyncOutcome['readmeStatus']): string {
  switch (status) {
    case 'pending':
      return 'Pending GitHub Actions regeneration on dev'
    case 'not-applicable':
      return 'Automatic regeneration is configured for the primary dev branch only'
    default:
      return 'No regeneration required'
  }
}
