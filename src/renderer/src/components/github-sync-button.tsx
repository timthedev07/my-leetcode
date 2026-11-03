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

  const accepted = useQuery({
    queryKey: ['latest-accepted-cpp', problem.titleSlug],
    enabled: leetcodeConnected && github.state === 'connected' && settings.data?.configured === true,
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
        : accepted.isPending
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
      if (nextPreview.identical) {
        void execute.mutateAsync(nextPreview)
      }
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const execute = useMutation({
    mutationFn: async (syncPreview: GitHubSyncPreview) => {
      const result = await window.desktop.executeGitHubSync(
        problem.titleSlug,
        problem.frontendId,
        problem.difficulty,
        syncPreview.requiresOverwriteConfirmation
      )
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (syncOutcome) => {
      setOutcome(syncOutcome)
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['github-settings'] })
      toast.success(
        syncOutcome.result === 'already-synchronised'
          ? 'Already synchronised.'
          : syncOutcome.result === 'updated'
            ? 'Accepted C++ solution updated on GitHub.'
            : 'Accepted C++ solution created on GitHub.'
      )
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const disabled = disabledReason !== null
  const caseConflict = preview?.existingPath !== null && preview?.existingPath !== preview?.path

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
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
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
            <DialogTitle>{outcome ? 'GitHub synchronisation' : 'Review GitHub synchronisation'}</DialogTitle>
            <DialogDescription>
              {outcome
                ? `${outcome.result.replaceAll('-', ' ')} · ${outcome.path}`
                : `Source: Accepted C++ submission #${preview?.sourceSubmissionId ?? accepted.data?.id}`}
            </DialogDescription>
          </DialogHeader>

          {outcome ? (
            <div className="border-y border-border py-5">
              <div className="flex items-center gap-2">
                <Check className="size-4 text-emerald-400" aria-hidden="true" />
                <p className="text-sm">{outcome.result.replaceAll('-', ' ')}</p>
              </div>
              <dl className="mt-4 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-xs">
                <dt className="text-muted">Path</dt>
                <dd className="font-mono text-foreground">{outcome.path}</dd>
                <dt className="text-muted">Submission</dt>
                <dd className="font-mono text-foreground">#{outcome.submissionId}</dd>
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
                  onClick={() => {
                    void window.desktop.openExternal(outcome.fileUrl)
                  }}
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open file
                </Button>
                {outcome.commitUrl ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void window.desktop.openExternal(outcome.commitUrl!)
                    }}
                  >
                    Open commit
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 border-y border-border py-4 text-xs">
                <span className="text-muted">Destination</span>
                <span className="font-mono text-foreground">{preview?.path}</span>
                <span className="text-muted">Problem URL</span>
                <button
                  type="button"
                  className="w-fit text-left text-accent underline underline-offset-2"
                  onClick={() => {
                    if (preview) void window.desktop.openExternal(preview.problemUrl)
                  }}
                >
                  {preview?.problemUrl}
                </button>
                <span className="text-muted">Commit subject</span>
                <span className="text-foreground">{preview?.commitMessage.split('\n')[0]}</span>
              </div>

              {caseConflict ? (
                <div className="flex items-start gap-2.5 border-l-2 border-amber-400/70 pl-3 text-xs leading-5 text-amber-100/85">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <p>
                    The repository contains <span className="font-mono">{preview?.existingPath}</span>. Rename it to{' '}
                    <span className="font-mono">{preview?.path}</span> in GitHub, then synchronise again. No duplicate was
                    created.
                  </p>
                </div>
              ) : null}

              <div className="grid min-h-0 grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="mb-1.5 text-[11px] text-muted">Accepted source</p>
                  <pre className="max-h-[42vh] overflow-auto rounded-md border border-border bg-[#141416] p-3 font-mono text-[11px] leading-5 text-foreground/85">
                    {preview?.sourceCode}
                  </pre>
                </div>
                <div className="min-w-0">
                  <p className="mb-1.5 text-[11px] text-muted">
                    {preview?.existingCode ? 'Current remote file' : 'Remote file'}
                  </p>
                  <pre className="max-h-[42vh] overflow-auto rounded-md border border-border bg-[#141416] p-3 font-mono text-[11px] leading-5 text-foreground/85">
                    {preview?.existingCode ?? 'No existing file.'}
                  </pre>
                </div>
              </div>
            </>
          )}

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
            {!outcome && !preview?.identical ? (
              <Button
                onClick={() => {
                  if (preview && !caseConflict) execute.mutate(preview)
                }}
                disabled={
                  execute.isPending ||
                  caseConflict ||
                  !preview ||
                  (preview.requiresOverwriteConfirmation && preview.existingPath !== null && !preview.existingCode)
                }
              >
                {execute.isPending ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <CloudUpload className="size-4" aria-hidden="true" />
                )}
                {preview?.existingPath ? 'Update file' : 'Create file'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

