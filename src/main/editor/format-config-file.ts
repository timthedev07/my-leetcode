import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from 'yaml'
import { DEFAULT_CLANG_FORMAT_YAML } from '@shared/constants'
import type { ClangFormatConfig } from '@shared/types'
import { AppError } from '../security/app-error'

export class ClangFormatFileStore {
  readonly filePath: string

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, '.clang-format')
  }

  async read(): Promise<ClangFormatConfig> {
    try {
      return { yaml: validateYaml(await readFile(this.filePath, 'utf8')) }
    } catch (error) {
      if (isMissingFile(error)) {
        await this.reset()
        return { yaml: DEFAULT_CLANG_FORMAT_YAML }
      }
      throw storageError('The local clang-format configuration could not be read.', error)
    }
  }

  async save(yaml: string): Promise<ClangFormatConfig> {
    const validated = validateYaml(yaml)
    await atomicWrite(this.filePath, validated)
    return { yaml: validated }
  }

  async reset(): Promise<ClangFormatConfig> {
    await atomicWrite(this.filePath, DEFAULT_CLANG_FORMAT_YAML)
    return { yaml: DEFAULT_CLANG_FORMAT_YAML }
  }

  async writeTo(path: string, yaml: string): Promise<void> {
    await atomicWrite(path, validateYaml(yaml))
  }
}

export function validateYaml(yaml: string): string {
  if (yaml.trim().length === 0 || yaml.length > 100_000) {
    throw new AppError('STORAGE_FAILED', 'Enter a non-empty clang-format configuration under 100 KB.')
  }
  try {
    const parsed: unknown = parse(yaml)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The root value must be a mapping of clang-format options.')
    }
  } catch (error) {
    throw new AppError(
      'STORAGE_FAILED',
      'The clang-format configuration is not valid YAML.',
      error instanceof Error ? error.message : undefined
    )
  }
  return yaml.endsWith('\n') ? yaml : `${yaml}\n`
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

export function storageError(message: string, cause: unknown): AppError {
  return new AppError('STORAGE_FAILED', message, cause instanceof Error ? cause.message : undefined)
}
