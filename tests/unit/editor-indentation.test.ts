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

  it('leaves brace indentation and closing braces to Monaco', () => {
    const line = '  if (values.empty()) {'
    expect(createSmartEnterInsertion(line, line.length + 1, '\n')).toBeNull()
  })

  it('continues line comments with one separating space', () => {
    const line = '    // explain the branch'
    expect(createSmartEnterInsertion(line, line.length + 1, '\n')).toEqual({
      text: '\n    // ',
      cursorColumn: 8
    })
  })

  it('leaves other newline behaviour to Monaco', () => {
    expect(createSmartEnterInsertion('return value;', 14, '\n')).toBeNull()
  })
})
