import { isMap, parseDocument } from 'yaml'

const DEFAULT_INDENT_WIDTH = 4
const MIN_INDENT_WIDTH = 1
const MAX_INDENT_WIDTH = 16

export type SmartEnterInsertion = {
  text: string
  cursorColumn: number
}

export function readClangFormatIndentWidth(style: string | null | undefined): number {
  if (!style?.trim()) return DEFAULT_INDENT_WIDTH

  const document = parseDocument(style)
  if (document.errors.length > 0 || !isMap(document.contents)) {
    return DEFAULT_INDENT_WIDTH
  }

  const value = (document.toJS() as Record<string, unknown>).IndentWidth
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_INDENT_WIDTH &&
    value <= MAX_INDENT_WIDTH
    ? value
    : DEFAULT_INDENT_WIDTH
}

export function createSmartEnterInsertion(
  lineContent: string,
  column: number,
  indentWidth: number,
  eol: string
): SmartEnterInsertion | null {
  const safeColumn = Math.max(1, Math.min(column, lineContent.length + 1))
  const beforeCursor = lineContent.slice(0, safeColumn - 1)
  if (!beforeCursor.trim()) return null

  const comment = beforeCursor.match(/^([ \t]*)(\/\/[/!]?)(?:[ \t]?)/)
  if (comment) {
    const prefix = `${comment[1]}${comment[2]} `
    return {
      text: `${eol}${prefix}`,
      cursorColumn: prefix.length + 1
    }
  }

  if (!/\{\s*$/.test(beforeCursor)) return null

  const baseIndent = beforeCursor.match(/^[ \t]*/)?.[0] ?? ''
  const prefix = `${baseIndent}${' '.repeat(
    Math.max(MIN_INDENT_WIDTH, Math.min(indentWidth, MAX_INDENT_WIDTH))
  )}`
  return {
    text: `${eol}${prefix}`,
    cursorColumn: prefix.length + 1
  }
}
