import { ChevronsUpDown, PanelLeft, PanelLeftClose, Search, UserRound } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { Kbd } from '@/components/kbd'
import { Button } from '@/components/ui/button'
import { shortcutLabel } from '@/hooks/use-keyboard-shortcuts'

type AppHeaderProps = {
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  onOpenSearch: () => void
  onOpenAccounts: () => void
}

export function AppHeader({
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSearch,
  onOpenAccounts
}: AppHeaderProps): React.JSX.Element {
  return (
    <header className="drag-region flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface/55 px-4 pl-[86px]">
      <Button
        variant="ghost"
        size="icon"
        className="no-drag size-7"
        aria-label={sidebarCollapsed ? 'Show recent problems' : 'Hide recent problems'}
        aria-pressed={!sidebarCollapsed}
        onClick={onToggleSidebar}
      >
        {sidebarCollapsed ? (
          <PanelLeft className="size-4" aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-4" aria-hidden="true" />
        )}
      </Button>

      <div className="flex w-[178px] shrink-0 items-center gap-2">
        <BrandMark />
        <span className="text-[13px] font-semibold tracking-tight">LeetCode Desktop</span>
      </div>

      <button
        type="button"
        onClick={onOpenSearch}
        aria-keyshortcuts={isMacShortcut()}
        className="no-drag group flex h-8 w-full max-w-[620px] items-center gap-2 rounded-md border border-border bg-background/40 px-3 text-left text-[13px] text-muted transition-colors hover:border-border-strong hover:bg-surface-raised/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Search problems by ID, title or slug</span>
        <Kbd className="shrink-0">{shortcutLabel('K')}</Kbd>
      </button>

      <Button variant="ghost" size="sm" className="no-drag ml-auto shrink-0" onClick={onOpenAccounts}>
        <UserRound className="size-3.5" aria-hidden="true" />
        Accounts
        <ChevronsUpDown className="size-3 text-muted/70" aria-hidden="true" />
      </Button>
    </header>
  )
}

function isMacShortcut(): string {
  return navigator.userAgent.includes('Mac') ? 'Meta+K' : 'Control+K'
}

