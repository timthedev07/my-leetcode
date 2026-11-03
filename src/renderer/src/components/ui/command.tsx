import { Command as CommandPrimitive } from 'cmdk'
import { Loader2, Search } from 'lucide-react'
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={cn(
      'flex size-full flex-col overflow-hidden rounded-lg bg-surface text-foreground',
      className
    )}
    {...props}
  />
))
Command.displayName = CommandPrimitive.displayName

type CommandDialogProps = ComponentPropsWithoutRef<typeof Dialog> & {
  className?: string
  title?: React.ReactNode
  description?: React.ReactNode
}

function CommandDialog({
  children,
  className,
  title = 'Search',
  description = 'Type to filter results.',
  ...props
}: CommandDialogProps): React.JSX.Element {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn('overflow-hidden p-0', className)}
        showCloseButton={false}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </VisuallyHidden.Root>
        <Command className="[&_[cmdk-input-wrapper]]:border-0">{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

type CommandInputProps = ComponentPropsWithoutRef<typeof CommandPrimitive.Input>

const CommandInput = forwardRef<ElementRef<typeof CommandPrimitive.Input>, CommandInputProps>(
  ({ className, autoComplete = 'off', spellCheck = false, ...props }, ref) => (
    <div
      className="flex h-11 items-center gap-2 border-b border-border px-3 focus-within:ring-2 focus-within:ring-inset focus-within:ring-ring"
      cmdk-input-wrapper=""
    >
      <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
      <CommandPrimitive.Input
        ref={ref}
        {...props}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
        aria-label={props['aria-label'] ?? 'Search'}
        className={cn(
          'flex h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-45',
          className
        )}
      />
    </div>
  )
)
CommandInput.displayName = CommandPrimitive.Input.displayName

const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-80 min-h-0 overflow-y-auto overflow-x-hidden p-1', className)}
    {...props}
  />
))
CommandList.displayName = CommandPrimitive.List.displayName

const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className={cn('py-8 text-center text-sm text-muted', className)}
    {...props}
  />
))
CommandEmpty.displayName = CommandPrimitive.Empty.displayName

const CommandLoading = forwardRef<
  ElementRef<typeof CommandPrimitive.Loading>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Loading>
>(({ className, children, ...props }, ref) => (
  <CommandPrimitive.Loading
    ref={ref}
    className={cn(
      'flex items-center justify-center gap-2 py-8 text-sm text-muted',
      className
    )}
    {...props}
  >
    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
    {children}
  </CommandPrimitive.Loading>
))
CommandLoading.displayName = CommandPrimitive.Loading.displayName

const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted',
      className
    )}
    {...props}
  />
))
CommandGroup.displayName = CommandPrimitive.Group.displayName

const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
))
CommandSeparator.displayName = CommandPrimitive.Separator.displayName

const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none transition-colors data-[disabled=true]:pointer-events-none data-[selected=true]:bg-surface-hover data-[selected=true]:text-foreground data-[disabled=true]:opacity-45',
      className
    )}
    {...props}
  />
))
CommandItem.displayName = CommandPrimitive.Item.displayName

function CommandShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>): React.JSX.Element {
  return (
    <span
      className={cn('ml-auto text-[11px] tracking-wide text-muted', className)}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandLoading,
  CommandSeparator,
  CommandShortcut
}
