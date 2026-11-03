import { format } from '@wasm-fmt/clang-format/node'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'
import { createSafeFormattingEdits } from '../../src/renderer/src/editor/format-model'

const unformatted = 'class Solution{public:int solve(vector<int>& nums){int total=0;for(int x:nums){total+=x;}return total;}};'

describe('local C++ formatting', () => {
  it('formats real C++ with the default competitive style', () => {
    const formatted = format(unformatted, 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)

    expect(formatted).toContain('class Solution {')
    expect(formatted).toContain('int total = 0;')
    expect(formatted).toContain('for (int x : nums) {')
    expect(formatted.split('\n').length).toBeGreaterThan(5)
  })

  it('is idempotent and formats partially written source', () => {
    const once = format(unformatted, 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)
    const twice = format(once, 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)
    const partial = format('class Solution{public:int solve(int x){if(x>0){return x;}', 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)

    expect(twice).toBe(once)
    expect(partial).toContain('class Solution {')
  })

  it('applies custom indentation and validation errors without changing source', () => {
    const custom = '---\nBasedOnStyle: Google\nIndentWidth: 2\nTabWidth: 2\nUseTab: Never\nColumnLimit: 80\nBreakBeforeBraces: Attach\nPointerAlignment: Left\nSortIncludes: Never\n'
    const formatted = format(unformatted, 'solution.cpp', custom)

    expect(formatted).toContain('\n public:')
    expect(() => format(unformatted, 'solution.cpp', 'BasedOnStyle: NotAStyle')).toThrow()
  })

  it('discards a formatting result when the model changed while waiting', async () => {
    let version = 4
    const model = {
      getVersionId: vi.fn(() => version),
      getValue: vi.fn(() => unformatted),
      isDisposed: vi.fn(() => false),
      getFullModelRange: vi.fn(() => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 }))
    }
    const formatter = vi.fn(async () => {
      version += 1
      return format(unformatted, 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)
    })

    const edits = await createSafeFormattingEdits(model as never, DEFAULT_CLANG_FORMAT_YAML, formatter)

    expect(edits).toEqual([])
  })

  it('does not create an edit when source is already formatted', async () => {
    const source = format(unformatted, 'solution.cpp', DEFAULT_CLANG_FORMAT_YAML)
    const model = {
      getVersionId: () => 1,
      getValue: () => source,
      isDisposed: () => false,
      getFullModelRange: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })
    }

    const edits = await createSafeFormattingEdits(
      model as never,
      DEFAULT_CLANG_FORMAT_YAML,
      async () => source
    )

    expect(edits).toEqual([])
  })
})
