import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Github, Loader2, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
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
import { useLeetCodeAuth } from '@/hooks/use-leetcode-auth'

type AccountsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenSettings: () => void
}

export function AccountsDialog({
  open,
  onOpenChange,
  onOpenSettings
}: AccountsDialogProps): React.JSX.Element {
  const auth = useLeetCodeAuth()
  const queryClient = useQueryClient()
  const [disconnectOpen, setDisconnectOpen] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const statistics = useQuery({
    queryKey: ['leetcode-statistics'],
    enabled: auth.status.state === 'connected',
    queryFn: async () => {
      const result = await window.desktop.getLeetCodeStatistics()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  const connect = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.connectLeetCode()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (status) => {
      setAuthError(null)
      queryClient.setQueryData(['leetcode-auth-status'], status)
    },
    onError: (error) => {
      setAuthError(error.message)
    }
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.disconnectLeetCode(true)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (status) => {
      queryClient.setQueryData(['leetcode-auth-status'], status)
      setDisconnectOpen(false)
      toast.success('LeetCode session and local browser profile cleared.')
    },
    onError: (error) => toast.error(error.message)
  })

  const connected = auth.status.state === 'connected'
  const connecting = auth.status.state === 'connecting'
  const all = statistics.data?.byDifficulty.find((item) => item.difficulty === 'All')

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Accounts</DialogTitle>
            <DialogDescription>External sessions and the selected solutions destination.</DialogDescription>
          </DialogHeader>

          <div className="divide-y divide-border border-y border-border">
            <div className="py-4">
              <div className="flex items-center gap-3">
                <span className="text-muted">
                  <UserRound className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm">LeetCode</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {connected
                      ? `Signed in as ${auth.status.username}`
                      : connecting
                        ? 'Waiting for browser sign-in'
                        : auth.status.state === 'expired'
                          ? 'Session expired'
                          : 'Not connected'}
                  </p>
                </div>
                <div className="ml-auto flex gap-2">
                  {connected ? (
                    <Button variant="ghost" size="sm" onClick={() => setDisconnectOpen(true)}>
                      <LogOut className="size-3.5" aria-hidden="true" />
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => connect.mutate()} disabled={connecting || connect.isPending}>
                      {connecting || connect.isPending ? (
                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : null}
                      {auth.status.state === 'expired' ? 'Reconnect' : 'Connect'}
                    </Button>
                  )}
                </div>
              </div>

              {connected && all ? (
                <dl className="mt-4 grid grid-cols-3 gap-3 border-l-2 border-accent/45 pl-3">
                  <div>
                    <dt className="text-[10px] text-muted">Solved</dt>
                    <dd className="mt-0.5 font-mono text-sm">{all.solved}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted">Attempted</dt>
                    <dd className="mt-0.5 font-mono text-sm">{all.attempted}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] text-muted">Ranking</dt>
                    <dd className="mt-0.5 font-mono text-sm">
                      {statistics.data?.ranking?.toLocaleString() ?? 'Unavailable'}
                    </dd>
                  </div>
                </dl>
              ) : null}

              {authError || connect.error ? (
                <p className="mt-3 text-xs leading-5 text-destructive" role="alert">
                  {authError ?? connect.error?.message}
                </p>
              ) : null}
              {connecting ? (
                <p className="mt-3 text-xs leading-5 text-muted" aria-live="polite">
                  Complete sign-in in the LeetCode browser window. This panel will update after LeetCode confirms the session.
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-3 py-4">
              <Github className="size-4 text-muted" aria-hidden="true" />
              <div>
                <p className="text-sm">GitHub</p>
                <p className="mt-0.5 text-xs text-muted">Configured in Settings</p>
              </div>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={onOpenSettings}>
                Configure
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2.5 text-xs leading-5 text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent/80" aria-hidden="true" />
            <p>Cookies remain inside the dedicated browser profile. GitHub tokens use the operating system’s encrypted secret storage.</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void window.desktop.openExternal('https://leetcode.com/')
              }}
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              Open LeetCode
            </Button>
            <Button onClick={onOpenSettings}>Settings</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the LeetCode session?</AlertDialogTitle>
            <AlertDialogDescription>
              This closes the login browser and deletes its dedicated profile. Local drafts remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                disconnect.mutate()
              }}
              disabled={disconnect.isPending}
            >
              Clear session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

