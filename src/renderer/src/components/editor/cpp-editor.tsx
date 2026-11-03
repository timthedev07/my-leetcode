import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from 'react'
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import type { PersistedEditorState } from '@shared/types'

type MonacoEnvironmentShape = {
  getWorker: () => Worker
}

;(self as unknown as { MonacoEnvironment: MonacoEnvironmentShape }).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

export type CppEditorHandle = {
  focus: () => void
  getEditorState: () => PersistedEditorState | null
  revealLine: (lineNumber: number) => void
}

type CppEditorProps = {
  modelKey: string
  initialValue: string
  value: string
  initialState: PersistedEditorState | null
  tabFocusMode: boolean
  readOnly?: boolean
  onChange?: (value: string) => void
  onBlur?: () => void
  onSave?: () => void
  onRun?: () => void
  onSubmit?: () => void
  onReady?: () => void
}

export const CppEditor = forwardRef<CppEditorHandle, CppEditorProps>(function CppEditor(
  {
    modelKey,
    initialValue,
    value,
    initialState,
    tabFocusMode,
    readOnly = false,
    onChange,
    onBlur,
    onSave,
    onRun,
    onSubmit,
    onReady
  },
  forwardedRef
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const onChangeRef = useRef(onChange)
  const onBlurRef = useRef(onBlur)
  const onSaveRef = useRef(onSave)
  const onRunRef = useRef(onRun)
  const onSubmitRef = useRef(onSubmit)
  const onReadyRef = useRef(onReady)
  const initialEditorPropsRef = useRef({
    modelKey,
    initialValue,
    initialState,
    readOnly,
    tabFocusMode
  })

  useEffect(() => {
    onChangeRef.current = onChange
    onBlurRef.current = onBlur
    onSaveRef.current = onSave
    onRunRef.current = onRun
    onSubmitRef.current = onSubmit
    onReadyRef.current = onReady
  }, [onBlur, onChange, onReady, onRun, onSave, onSubmit])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const initial = initialEditorPropsRef.current
    defineTheme()
    const model = createModel(initial.modelKey, initial.initialValue)
    modelRef.current = model
    const editor = monaco.editor.create(host, {
      model,
      theme: 'leetcode-desktop',
      fontFamily: 'Monaco, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 21,
      lineNumbersMinChars: 3,
      automaticLayout: true,
      minimap: { enabled: false },
      folding: true,
      bracketPairColorization: { enabled: true },
      guides: { indentation: false, bracketPairs: false },
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      padding: { top: 14, bottom: 18 },
      tabSize: 4,
      insertSpaces: true,
      wordWrap: 'off',
      readOnly: initial.readOnly,
      accessibilitySupport: 'auto',
      tabFocusMode: initial.tabFocusMode,
      stickyScroll: { enabled: false },
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      fixedOverflowWidgets: true,
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false
      }
    })
    editorRef.current = editor

    const changeSubscription = editor.onDidChangeModelContent(() => {
      if (!editor.getOption(monaco.editor.EditorOption.readOnly)) onChangeRef.current?.(editor.getValue())
    })
    const blurSubscription = editor.onDidBlurEditorText(() => onBlurRef.current?.())

    const saveAction = editor.addAction({
      id: 'leetcode-desktop.save',
      label: 'Save C++ draft',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current?.()
    })
    const runAction = editor.addAction({
      id: 'leetcode-desktop.run',
      label: 'Run C++ tests',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => onRunRef.current?.()
    })
    const submitAction = editor.addAction({
      id: 'leetcode-desktop.submit',
      label: 'Submit C++ solution',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => onSubmitRef.current?.()
    })

    requestAnimationFrame(() => {
      restoreState(editor, initial.initialState)
      onReadyRef.current?.()
    })

    return () => {
      saveAction.dispose()
      runAction.dispose()
      submitAction.dispose()
      changeSubscription.dispose()
      blurSubscription.dispose()
      editor.dispose()
      modelRef.current?.dispose()
      modelRef.current = null
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.getValue() === value) return
    const position = editor.getPosition()
    editor.setValue(value)
    if (position) editor.setPosition(position)
  }, [value])

  useEffect(() => {
    editorRef.current?.updateOptions({ tabFocusMode, readOnly })
  }, [readOnly, tabFocusMode])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const nextModel = createModel(modelKey, initialValue)
    const previousModel = modelRef.current
    editor.setModel(nextModel)
    modelRef.current = nextModel
    if (previousModel && previousModel !== nextModel) previousModel.dispose()
    requestAnimationFrame(() => {
      restoreState(editor, initialState)
      editor.layout()
    })
  }, [initialState, initialValue, modelKey])

  useImperativeHandle(
    forwardedRef,
    () => ({
      focus: () => editorRef.current?.focus(),
      getEditorState: () => {
        const editor = editorRef.current
        if (!editor) return null
        const cursor = editor.getPosition()
        if (!cursor) return { cursor: { lineNumber: 1, column: 1 }, selection: null, scrollTop: 0 }
        const selection = editor.getSelection()
        return {
          cursor,
          selection:
            selection && !selection.isEmpty()
              ? {
                  start: {
                    lineNumber: selection.startLineNumber,
                    column: selection.startColumn
                  },
                  end: {
                    lineNumber: selection.endLineNumber,
                    column: selection.endColumn
                  }
                }
              : null,
          scrollTop: editor.getScrollTop()
        }
      },
      revealLine: (lineNumber) => editorRef.current?.revealLineInCenter(lineNumber)
    }),
    []
  )

  return (
    <div
      ref={hostRef}
      className="h-full min-h-0 w-full"
      data-monaco-editor=""
      aria-label="C++ code editor"
      role="region"
    />
  )
})

function createModel(
  key: string,
  initialValue: string
): monaco.editor.ITextModel {
  const existing = monaco.editor.getModel(monaco.Uri.parse(`leetcode://problem/${key}/solution.cpp`))
  if (existing) return existing
  const model = monaco.editor.createModel(
    initialValue,
    'cpp',
    monaco.Uri.parse(`leetcode://problem/${key}/solution.cpp`)
  )
  return model
}

function restoreState(
  editor: monaco.editor.IStandaloneCodeEditor,
  state: PersistedEditorState | null
): void {
  if (!state) return
  const selection = state.selection
    ? new monaco.Selection(
        state.selection.start.lineNumber,
        state.selection.start.column,
        state.selection.end.lineNumber,
        state.selection.end.column
      )
    : undefined
  editor.setPosition(state.cursor)
  editor.setSelection(selection ?? new monaco.Selection(
    state.cursor.lineNumber,
    state.cursor.column,
    state.cursor.lineNumber,
    state.cursor.column
  ))
  editor.setScrollTop(state.scrollTop)
}

function defineTheme(): void {
  monaco.editor.defineTheme('leetcode-desktop', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '77736d', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'd0b46e' },
      { token: 'string', foreground: 'a9c58d' },
      { token: 'number', foreground: 'd79c74' },
      { token: 'type', foreground: 'ded9cc' },
      { token: 'identifier', foreground: 'eeece5' },
      { token: 'delimiter', foreground: 'a19e99' }
    ],
    colors: {
      'editor.background': '#141416',
      'editor.foreground': '#eeece5',
      'editorLineNumber.foreground': '#57565b',
      'editorLineNumber.activeForeground': '#b8b3a8',
      'editor.lineHighlightBackground': '#1b1b1f',
      'editor.selectionBackground': '#4a402a',
      'editor.inactiveSelectionBackground': '#302c24',
      'editorCursor.foreground': '#c9a75d',
      'editorIndentGuide.background1': '#27272c',
      'editorIndentGuide.activeBackground1': '#3a3833',
      'editorBracketMatch.background': '#263027',
      'editorBracketMatch.border': '#6e8a65',
      'editorWidget.background': '#1d1d21',
      'editorWidget.border': '#303036',
      'input.background': '#161619',
      'input.border': '#303036',
      'scrollbarSlider.background': '#5a5a6166',
      'scrollbarSlider.hoverBackground': '#6a6a7288',
      'scrollbarSlider.activeBackground': '#777780aa'
    }
  })
}

