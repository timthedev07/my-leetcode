import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleAlert,
  CircleCheck,
  Download,
  Loader2,
  RotateCcw,
  Save,
  Upload
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { isMap, parseDocument } from 'yaml'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { clangFormat } from '@/editor/clang-format-client'
import type { ClangFormatPreset, ClangFormatValidation } from '@shared/types'

const VALIDATION_DEBOUNCE_MS = 350
const SAMPLE_CPP = `#include <vector>
using namespace std;
class Solution{public:int answer(vector<int>& values){int total=0;for(int value:values){total+=value;}return total;}};`

const PRESETS = [
  'LLVM',
  'Google',
  'Chromium',
  'Microsoft',
  'Mozilla',
  'WebKit',
  'GNU'
] as const satisfies readonly ClangFormatPreset[]

const USE_TAB_OPTIONS = [
  'Never',
  'ForIndentation',
  'ForContinuationAndIndentation',
  'AlignWithSpaces',
  'Always'
] as const

const BREAK_BEFORE_BRACES_OPTIONS = [
  'Attach',
  'Linux',
  'Mozilla',
  'Stroustrup',
  'Allman',
  'GNU',
  'WebKit',
  'Custom'
] as const

const POINTER_ALIGNMENT_OPTIONS = ['Left', 'Right', 'Middle'] as const

type PresetValue = (typeof PRESETS)[number] | 'Custom'
type UseTabValue = (typeof USE_TAB_OPTIONS)[number]
type BreakBeforeBracesValue = (typeof BREAK_BEFORE_BRACES_OPTIONS)[number]
type PointerAlignmentValue = (typeof POINTER_ALIGNMENT_OPTIONS)[number]

type ParsedFormatConfig = {
  valid: boolean
  error: string | null
  preset: PresetValue
  indentWidth: number
  columnLimit: number
  useTab: UseTabValue
  breakBeforeBraces: BreakBeforeBracesValue
  pointerAlignment: PointerAlignmentValue
}

const DEFAULT_VALUES = {
  preset: 'LLVM' as PresetValue,
  indentWidth: 4,
  columnLimit: 100,
  useTab: 'Never' as UseTabValue,
  breakBeforeBraces: 'Attach' as BreakBeforeBracesValue,
  pointerAlignment: 'Left' as PointerAlignmentValue
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function includesValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T)
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function parseFormatConfig(yaml: string): ParsedFormatConfig {
  if (!yaml.trim()) {
    return {
      valid: false,
      error: 'Enter a clang-format configuration.',
      ...DEFAULT_VALUES
    }
  }

  const document = parseDocument(yaml)
  const firstError = document.errors[0]
  if (firstError || !isMap(document.contents)) {
    return {
      valid: false,
      error: firstError?.message ?? 'The configuration root must be a YAML mapping.',
      ...DEFAULT_VALUES
    }
  }

  const values = asRecord(document.toJS())
  const basedOnStyle = values.BasedOnStyle

  return {
    valid: true,
    error: null,
    preset: includesValue(PRESETS, basedOnStyle) ? basedOnStyle : 'Custom',
    indentWidth: readNumber(values.IndentWidth, DEFAULT_VALUES.indentWidth),
    columnLimit: readNumber(values.ColumnLimit, DEFAULT_VALUES.columnLimit),
    useTab: includesValue(USE_TAB_OPTIONS, values.UseTab) ? values.UseTab : DEFAULT_VALUES.useTab,
    breakBeforeBraces: includesValue(BREAK_BEFORE_BRACES_OPTIONS, values.BreakBeforeBraces)
      ? values.BreakBeforeBraces
      : DEFAULT_VALUES.breakBeforeBraces,
    pointerAlignment: includesValue(POINTER_ALIGNMENT_OPTIONS, values.PointerAlignment)
      ? values.PointerAlignment
      : DEFAULT_VALUES.pointerAlignment
  }
}

function setYamlValue(yaml: string, key: string, value: string | number): string | null {
  const document = parseDocument(yaml)
  if (document.errors.length > 0 || !isMap(document.contents)) return null
  document.setIn([key], value)
  return document.toString({ lineWidth: 0 })
}

function deleteYamlValue(yaml: string, key: string): string | null {
  const document = parseDocument(yaml)
  if (document.errors.length > 0 || !isMap(document.contents)) return null
  document.deleteIn([key])
  return document.toString({ lineWidth: 0 })
}

export function FormattingSettingsPanel(): React.JSX.Element {
  const queryClient = useQueryClient()
  const initialised = useRef(false)
  const [yaml, setYaml] = useState('')
  const [savedYaml, setSavedYaml] = useState('')
  const [validationRevision, setValidationRevision] = useState<{
    yaml: string
    result: ClangFormatValidation
  } | null>(null)

  const settings = useQuery({
    queryKey: ['clang-format-config'],
    queryFn: async () => {
      const result = await window.desktop.getClangFormatConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    staleTime: Infinity
  })

  useEffect(() => {
    if (!settings.data || initialised.current) return
    initialised.current = true
    setYaml(settings.data.yaml)
    setSavedYaml(settings.data.yaml)
  }, [settings.data])

  const parsed = useMemo(() => parseFormatConfig(yaml), [yaml])

  useEffect(() => {
    if (!yaml || !parsed.valid) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      void clangFormat.validate(yaml).then((result) => {
        if (cancelled) return
        setValidationRevision({ yaml, result })
      })
    }, VALIDATION_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [parsed.valid, yaml])

  const save = useMutation({
    mutationFn: async (nextYaml: string) => {
      const result = await window.desktop.saveClangFormatConfig(nextYaml)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (config) => {
      queryClient.setQueryData(['clang-format-config'], config)
      setYaml(config.yaml)
      setSavedYaml(config.yaml)
      toast.success('Formatting configuration saved.')
    },
    onError: (error) => toast.error(error.message)
  })

  const reset = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.resetClangFormatConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (config) => {
      queryClient.setQueryData(['clang-format-config'], config)
      setYaml(config.yaml)
      setSavedYaml(config.yaml)
      toast.success('Formatting configuration reset to the default.')
    },
    onError: (error) => toast.error(error.message)
  })

  const importConfig = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.importClangFormatConfig()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (result) => {
      if (!result) return
      setYaml(result.yaml)
      toast.success(`Imported ${result.fileName}.`)
    },
    onError: (error) => toast.error(error.message)
  })

  const exportConfig = useMutation({
    mutationFn: async () => {
      const result = await window.desktop.exportClangFormatConfig(yaml)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    },
    onSuccess: (result) => {
      if (result.saved && result.fileName) toast.success(`Exported ${result.fileName}.`)
    },
    onError: (error) => toast.error(error.message)
  })

  const currentValidation = validationRevision?.yaml === yaml ? validationRevision.result : null
  const isChecking = parsed.valid && currentValidation === null
  const exactRevisionValid = parsed.valid && currentValidation?.valid === true
  const controlsDisabled = !parsed.valid || !yaml
  const saveDisabled = !exactRevisionValid || yaml === savedYaml || save.isPending
  const validationMessage = parsed.error ?? currentValidation?.error
  const preview =
    exactRevisionValid && currentValidation?.formattedPreview
      ? currentValidation.formattedPreview
      : null

  function updateValue(key: string, value: string | number): void {
    const nextYaml = setYamlValue(yaml, key, value)
    if (nextYaml) setYaml(nextYaml)
  }

  function changePreset(value: PresetValue): void {
    if (value === 'Custom') {
      const nextYaml = deleteYamlValue(yaml, 'BasedOnStyle')
      if (nextYaml) setYaml(nextYaml)
      return
    }
    updateValue('BasedOnStyle', value)
  }

  if (settings.isPending) {
    return (
      <div className="grid min-h-48 place-items-center text-sm text-muted">
        <Loader2 className="mb-2 size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Loading formatting settings
      </div>
    )
  }

  if (settings.isError) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center text-center" role="alert">
        <CircleAlert className="size-5 text-destructive" aria-hidden="true" />
        <p className="mt-2 text-sm text-foreground">Formatting settings could not be loaded.</p>
        <p className="mt-1 max-w-md text-xs text-muted">{settings.error.message}</p>
        <Button className="mt-3" variant="outline" size="sm" onClick={() => void settings.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3" disabled={controlsDisabled}>
        <div className="grid gap-1.5">
          <label htmlFor="format-preset" className="text-xs text-muted">
            Preset
          </label>
          <Select value={parsed.preset} onValueChange={(value) => changePreset(value as PresetValue)}>
            <SelectTrigger id="format-preset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((preset) => (
                <SelectItem key={preset} value={preset}>
                  {preset}
                </SelectItem>
              ))}
              <SelectItem value="Custom">Custom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="format-indent-width" className="text-xs text-muted">
            IndentWidth
          </label>
          <input
            id="format-indent-width"
            type="number"
            min={1}
            max={16}
            step={1}
            value={parsed.indentWidth}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value >= 1 && value <= 16) {
                updateValue('IndentWidth', value)
              }
            }}
            className="h-8 rounded-md border border-border bg-surface px-2.5 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="format-column-limit" className="text-xs text-muted">
            ColumnLimit
          </label>
          <input
            id="format-column-limit"
            type="number"
            min={0}
            max={1000}
            step={1}
            value={parsed.columnLimit}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (Number.isInteger(value) && value >= 0 && value <= 1000) {
                updateValue('ColumnLimit', value)
              }
            }}
            className="h-8 rounded-md border border-border bg-surface px-2.5 font-mono text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="format-use-tab" className="text-xs text-muted">
            UseTab
          </label>
          <Select value={parsed.useTab} onValueChange={(value) => updateValue('UseTab', value)}>
            <SelectTrigger id="format-use-tab">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USE_TAB_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="format-braces" className="text-xs text-muted">
            BreakBeforeBraces
          </label>
          <Select
            value={parsed.breakBeforeBraces}
            onValueChange={(value) => updateValue('BreakBeforeBraces', value)}
          >
            <SelectTrigger id="format-braces">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BREAK_BEFORE_BRACES_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="format-pointer-alignment" className="text-xs text-muted">
            PointerAlignment
          </label>
          <Select
            value={parsed.pointerAlignment}
            onValueChange={(value) => updateValue('PointerAlignment', value)}
          >
            <SelectTrigger id="format-pointer-alignment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POINTER_ALIGNMENT_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <label htmlFor="format-yaml" className="text-xs text-muted">
          Configuration YAML
        </label>
        <textarea
          id="format-yaml"
          value={yaml}
          onChange={(event) => setYaml(event.target.value)}
          spellCheck={false}
          aria-invalid={!parsed.valid}
          aria-describedby="format-validation"
          className="min-h-44 resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 aria-[invalid=true]:border-destructive/70"
        />
      </div>

      <div
        id="format-validation"
        className="flex min-h-5 items-start gap-2 text-xs leading-5"
        aria-live="polite"
      >
        {isChecking ? (
          <>
            <Loader2
              className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="text-muted">Checking configuration</span>
          </>
        ) : validationMessage ? (
          <>
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" aria-hidden="true" />
            <span className="text-destructive">{validationMessage}</span>
          </>
        ) : exactRevisionValid ? (
          <>
            <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="text-muted">Configuration valid</span>
          </>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section aria-labelledby="format-before-label">
          <p id="format-before-label" className="mb-1.5 text-xs text-muted">
            Before
          </p>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-muted">
            {SAMPLE_CPP}
          </pre>
        </section>
        <section aria-labelledby="format-after-label">
          <p id="format-after-label" className="mb-1.5 text-xs text-muted">
            After
          </p>
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-5 text-foreground">
            {preview ?? (isChecking ? 'Formatting preview…' : 'No valid preview')}
          </pre>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => importConfig.mutate()}
          disabled={importConfig.isPending}
        >
          {importConfig.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Upload className="size-3.5" aria-hidden="true" />
          )}
          Import
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportConfig.mutate()}
          disabled={!exactRevisionValid || exportConfig.isPending}
        >
          {exportConfig.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
          Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
        >
          {reset.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <RotateCcw className="size-3.5" aria-hidden="true" />
          )}
          Reset
        </Button>
        <Button
          className="ml-auto"
          size="sm"
          onClick={() => save.mutate(yaml)}
          disabled={saveDisabled}
        >
          {save.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          Save
        </Button>
      </div>
    </div>
  )
}
