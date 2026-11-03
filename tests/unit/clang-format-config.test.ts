import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'
import { ClangFormatFileStore } from '../../src/main/editor/format-config-file'

const temporaryDirectories: string[] = []

async function createStore(): Promise<ClangFormatFileStore> {
  const directory = await mkdtemp(join(tmpdir(), 'leetcode-format-config-'))
  temporaryDirectories.push(directory)
  return new ClangFormatFileStore(directory)
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('.clang-format persistence', () => {
  it('creates and returns the competitive-programming default', async () => {
    const store = await createStore()

    await expect(store.read()).resolves.toEqual({ yaml: DEFAULT_CLANG_FORMAT_YAML })
    await expect(readFile(store.filePath, 'utf8')).resolves.toBe(DEFAULT_CLANG_FORMAT_YAML)
  })

  it('persists valid custom configuration with a newline', async () => {
    const store = await createStore()
    const yaml = 'BasedOnStyle: Google\nIndentWidth: 2'

    await store.save(yaml)

    await expect(store.read()).resolves.toEqual({ yaml: `${yaml}\n` })
  })

  it('rejects invalid YAML without replacing the last valid file', async () => {
    const store = await createStore()
    const valid = 'BasedOnStyle: LLVM\nIndentWidth: 3\n'
    await store.save(valid)

    await expect(store.save('IndentWidth: [')).rejects.toMatchObject({
      code: 'STORAGE_FAILED'
    })
    await expect(store.read()).resolves.toEqual({ yaml: valid })
  })

  it('resets to the documented defaults', async () => {
    const store = await createStore()
    await store.save('BasedOnStyle: GNU\n')

    await expect(store.reset()).resolves.toEqual({ yaml: DEFAULT_CLANG_FORMAT_YAML })
  })

  it('writes exported configuration only to the selected file', async () => {
    const store = await createStore()
    const exportPath = join(dirname(store.filePath), 'exported.clang-format')
    const current = 'BasedOnStyle: LLVM\n'
    const exported = 'BasedOnStyle: Mozilla\nIndentWidth: 2\n'
    await writeFile(exportPath, current, 'utf8')

    await store.writeTo(exportPath, exported)

    await expect(readFile(exportPath, 'utf8')).resolves.toBe(exported)
  })
})
