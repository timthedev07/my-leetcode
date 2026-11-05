import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Braces,
  BookOpen,
  CircleAlert,
  Copy,
  Github,
  Loader2,
  LogOut,
  ShieldCheck
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { FormattingSettingsPanel } from '@/components/formatting-settings-panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useGitHubAuth } from '@/hooks/use-github-auth'

type GitHubSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenDocs: () => void
}

export function GitHubSettingsDialog({
  open,
  onOpenChange,
  onOpenDocs
}: GitHubSettingsDialogProps): React.JSX.Element {
  const queryClient = useQueryClient()
  const auth = useGitHubAuth()
  const [clientId, setClientId] = useState('')
  const [deviceCode, setDeviceCode] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('')
  const [savedSettings, setSavedSettings] = useState(false)

  const settings = useQuery({
    queryKey: ['github-settings'],
    enabled: open,
    queryFn: async () => {
      const result = await window.desktop.getGitHubSettings()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  const configuredClientId = useQuery({
    queryKey: ['github-client-id'],
    enabled: open,
    queryFn: async () => {
      const result = await window.desktop.getGitHubClientId()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
  })

  const effectiveClientId = clientId || configuredClientId.data || ''
  const effectiveRepository = repository || settings.data?.repository || ''
  const effectiveBranch = branch || settings.data?.branch || ''

  const repositories = useQuery({
    queryKey: ['github-repositories'],
    enabled: open && auth.state === 'connected',
    queryFn: async () => {
      const result = await window.desktop.getGitHubRepositories()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  const branches = useQuery({
    queryKey: ['github-branches', effectiveRepository],
    enabled:
      open &&
      auth.state === 'connected' &&
      /^[^/]+\/[^/]+$/.test(effectiveRepository),
    queryFn: async () => {
      const result = await window.desktop.getGitHubBranches(effectiveRepository)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    retry: false
  })

  const saveClientId = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.setGitHubClientId(effectiveClientId.trim())
      if (!result.ok) throw new Error(result.error.message)
      return true
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['github-client-id'] })
      setError(null)
    },
    onError: (mutationError) => setError(mutationError.message)
  })

  const startAuth = useMutation({
    mutationFn: async () => {
      if (!effectiveClientId.trim()) throw new Error('Enter the public GitHub OAuth client ID first.')
      const clientResult = await window.desktop.setGitHubClientId(effectiveClientId.trim())
      if (!clientResult.ok) throw new Error(clientResult.error.message)
      const result = await window.desktop.startGitHubAuth()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onMutate: () => {
      setPending(true)
      setError(null)
      setDeviceCode(null)
    },
    onSuccess: (authorisation) => {
      setDeviceCode(authorisation.userCode)
      queryClient.setQueryData(['github-auth-status'], {
        state: 'pending',
        username: null,
        avatarUrl: null
      })
      void (async () => {
        const result = await window.desktop.waitForGitHubAuth()
        if (!result.ok) {
          setError(result.error.message)
        } else {
          queryClient.setQueryData(['github-auth-status'], result.data)
          toast.success(`GitHub connected as ${result.data.username}.`)
        }
        setPending(false)
        setDeviceCode(null)
      })()
    },
    onError: (mutationError) => {
      setPending(false)
      setError(mutationError.message)
    }
  })

  const cancelAuth = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.cancelGitHubAuth()
      if (!result.ok) throw new Error(result.error.message)
      return true
    },
    onSettled: () => {
      setPending(false)
      setDeviceCode(null)
      queryClient.setQueryData(['github-auth-status'], {
        state: 'disconnected',
        username: null,
        avatarUrl: null
      })
    }
  })

  const disconnect = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.disconnectGitHub()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (status) => {
      queryClient.setQueryData(['github-auth-status'], status)
      queryClient.removeQueries({ queryKey: ['github-progress'] })
      setRepository('')
      setBranch('')
      toast.success('GitHub token removed from this Mac.')
    },
    onError: (mutationError) => toast.error(mutationError.message)
  })

  const saveSettings = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.saveGitHubSettings(effectiveRepository, effectiveBranch)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (nextSettings) => {
      queryClient.setQueryData(['github-settings'], nextSettings)
      void queryClient.invalidateQueries({ queryKey: ['github-progress'] })
      setSavedSettings(true)
      toast.success(`Destination confirmed: ${nextSettings.repository} · ${nextSettings.branch}`)
    },
    onError: (mutationError) => {
      setSavedSettings(false)
      toast.error(mutationError.message)
    }
  })

  async function copyDeviceCode(): Promise<void> {
    if (!deviceCode) return
    const result = await window.desktop.copyText(deviceCode)
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    toast.success('Device code copied.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage C++ formatting and GitHub synchronisation.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="formatting">
          <TabsList className="h-10 w-fit gap-1 rounded-none border-0 bg-transparent p-0">
            <TabsTrigger
              value="formatting"
              className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
            >
              <Braces className="mr-1.5 size-3.5" aria-hidden="true" />
              Formatting
            </TabsTrigger>
            <TabsTrigger
              value="github"
              className="h-10 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:ring-0"
            >
              <Github className="mr-1.5 size-3.5" aria-hidden="true" />
              GitHub
            </TabsTrigger>
          </TabsList>

          <TabsContent value="formatting" className="mt-4">
            <FormattingSettingsPanel />
          </TabsContent>

          <TabsContent value="github" className="mt-4">
            <div className="space-y-4 border-y border-border py-4">
          <div className="flex items-center gap-3">
            <Github className="size-4 text-muted" aria-hidden="true" />
            <div>
              <p className="text-sm">GitHub account</p>
              <p className="mt-0.5 text-xs text-muted">
                {auth.state === 'connected'
                  ? `Connected as ${auth.username}`
                  : pending
                    ? 'Waiting for authorisation'
                    : 'Not connected'}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={onOpenDocs}
            >
              <BookOpen className="size-3.5" aria-hidden="true" />
              How to connect GitHub
            </Button>
            {auth.state === 'connected' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => disconnect.mutate()}
                disabled={disconnect.isPending}
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                Disconnect
              </Button>
            ) : null}
          </div>

          {auth.state !== 'connected' ? (
            <div>
              <label htmlFor="github-client-id" className="text-xs font-medium text-foreground">
                Public OAuth client ID
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="github-client-id"
                  value={effectiveClientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="Registered OAuth App client ID"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted/60 focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveClientId.mutate()}
                  disabled={!effectiveClientId.trim() || saveClientId.isPending}
                >
                  Save
                </Button>
                <Button size="sm" onClick={() => startAuth.mutate()} disabled={pending || startAuth.isPending}>
                  {pending || startAuth.isPending ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : null}
                  Connect
                </Button>
              </div>
            </div>
          ) : null}

          {deviceCode ? (
            <div className="rounded-md border border-accent/35 bg-accent/5 p-3">
              <p className="text-xs text-muted">Enter this code on GitHub</p>
              <p className="mt-1 font-mono text-lg tracking-[0.14em] text-accent">{deviceCode}</p>
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void copyDeviceCode()}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  Copy code
                </Button>
                <Button variant="ghost" size="sm" onClick={() => cancelAuth.mutate()}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="flex items-start gap-2 text-xs leading-5 text-destructive" role="alert">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {error}
            </p>
          ) : null}

          {auth.state === 'connected' ? (
            <div className="grid gap-3 border-t border-border pt-4">
              <div className="grid gap-1.5">
                <label className="text-xs text-muted" htmlFor="github-repository-trigger">
                  Repository
                </label>
                <Select
                  value={effectiveRepository}
                  onValueChange={(value) => {
                    setRepository(value)
                    setSavedSettings(false)
                    const match = repositories.data?.find((item) => item.fullName === value)
                    setBranch(match?.defaultBranch ?? '')
                  }}
                  disabled={repositories.isPending}
                >
                  <SelectTrigger id="github-repository-trigger" className="h-8">
                    <SelectValue placeholder={repositories.isPending ? 'Loading repositories' : 'Choose a repository'} />
                  </SelectTrigger>
                  <SelectContent>
                    {repositories.data?.map((repositoryItem) => (
                      <SelectItem
                        key={repositoryItem.fullName}
                        value={repositoryItem.fullName}
                        disabled={!repositoryItem.canPush}
                      >
                        {repositoryItem.fullName}
                        {repositoryItem.private ? ' · private' : ''}
                        {!repositoryItem.canPush ? ' · read only' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <label className="text-xs text-muted" htmlFor="github-branch-trigger">
                  Branch
                </label>
                <Select
                  value={effectiveBranch}
                  onValueChange={(value) => {
                    setBranch(value)
                    setSavedSettings(false)
                  }}
                  disabled={!effectiveRepository || branches.isPending}
                >
                  <SelectTrigger id="github-branch-trigger" className="h-8">
                    <SelectValue placeholder={branches.isPending ? 'Loading branches' : 'Choose a branch'} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.data?.map((branchItem) => (
                      <SelectItem key={branchItem.name} value={branchItem.name}>
                        {branchItem.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {repositories.isError ? (
                <p className="text-xs text-destructive">{repositories.error.message}</p>
              ) : null}
              {branches.isError ? <p className="text-xs text-destructive">{branches.error.message}</p> : null}

              <div className="flex items-center gap-3">
                <p className="text-xs text-muted">
                  {savedSettings || settings.data?.configured
                    ? `${effectiveRepository} · ${effectiveBranch}`
                    : 'The destination must be verified before the first write.'}
                </p>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => saveSettings.mutate()}
                  disabled={
                    !effectiveRepository ||
                    !effectiveBranch ||
                    saveSettings.isPending ||
                    savedSettings
                  }
                >
                  {saveSettings.isPending ? (
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : null}
                  Verify destination
                </Button>
              </div>
            </div>
          ) : null}
            </div>

            <div className="mt-4 flex items-start gap-2.5 text-xs leading-5 text-muted">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent/80" aria-hidden="true" />
              <p>
                Only the public client ID is stored in settings. GitHub access and refresh tokens
                are encrypted locally and never use the macOS Keychain.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

