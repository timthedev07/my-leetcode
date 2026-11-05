import { describe, expect, it } from 'vitest'
import {
  createSmartEnterInsertion,
  readClangFormatIndentWidth
} from '../../src/renderer/src/editor/editor-indentation'

describe('editor indentation behaviour', () => {
  it('reads the configured clang-format indentation width', () => {
    expect(readClangFormatIndentWidth('---\nIndentWidth: 2\n')).toBe(2)
    expect(readClangFormatIndentWidth('BasedOnStyle: LLVM\n')).toBe(4)
    expect(readClangFormatIndentWidth('IndentWidth: 0\n')).toBe(4)
    expect(readClangFormatIndentWidth('IndentWidth: [')).toBe(4)
  })

  it('indents a new scope by the configured width', () => {
    const line = '  if (values.empty()) {'
    expect(createSmartEnterInsertion(line, line.length + 1, 6, '\n')).toEqual({
      text: '\n        \n  }',
      cursorColumn: 9,
      replaceTrailingCloseBrace: false
    })
  })

  it('moves an automatically inserted closing brace onto its aligned line', () => {
    const line = 'void solve() {}'
    const cursorAfterOpeningBrace = line.indexOf('{') + 2
    expect(createSmartEnterInsertion(line, cursorAfterOpeningBrace, 4, '\n')).toEqual({
      text: '\n    \n}',
      cursorColumn: 5,
      replaceTrailingCloseBrace: true
    })
  })

  it('reuses an existing closing brace on the following line', () => {
    const line = '  if (ready) {'
    expect(createSmartEnterInsertion(line, line.length + 1, 4, '\n', '  }')).toEqual({
      text: '\n      ',
      cursorColumn: 7,
      replaceTrailingCloseBrace: false
    })
  })

  it('continues line comments with one separating space', () => {
    const line = '    // explain the branch'
    expect(createSmartEnterInsertion(line, line.length + 1, 4, '\n')).toEqual({
      text: '\n    // ',
      cursorColumn: 8,
      replaceTrailingCloseBrace: false
    })
  })

  it('leaves other newline behaviour to Monaco', () => {
    expect(createSmartEnterInsertion('return value;', 14, 4, '\n')).toBeNull()
  })
})
