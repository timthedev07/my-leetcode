import type * as Monaco from 'monaco-editor/editor/editor.api.js'

type Formatter = (source: string, style: string) => Promise<string>

export async function createSafeFormattingEdits(
  model: Monaco.editor.ITextModel,
  style: string,
  formatter: Formatter
): Promise<Monaco.languages.TextEdit[]> {
  const versionId = model.getVersionId()
  const source = model.getValue()
  const formatted = await formatter(source, style)

  if (model.isDisposed() || model.getVersionId() !== versionId || formatted === source) {
    return []
  }

  return [
    {
      range: model.getFullModelRange(),
      text: formatted
    }
  ]
}
