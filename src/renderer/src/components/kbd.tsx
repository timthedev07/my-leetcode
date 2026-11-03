import { cn } from '@/lib/utils'

type KbdProps = {
  children: React.ReactNode
  className?: string
}

export function Kbd({ children, className }: KbdProps): React.JSX.Element {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-surface-raised px-1.5 font-sans text-[10px] font-medium text-muted',
        className
      )}
    >
      {children}
    </kbd>
  )
}

