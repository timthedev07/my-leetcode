import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import type {
  ClangFormatConfig,
  ClangFormatExportResult,
  ClangFormatImportResult
} from '@shared/types'
import { ClangFormatFileStore, storageError, validateYaml } from './format-config-file'

export class ClangFormatConfigStore {
  readonly filePath: string
  private readonly files: ClangFormatFileStore

  constructor(userDataPath: string) {
    this.files = new ClangFormatFileStore(userDataPath)
    this.filePath = this.files.filePath
  }

  read(): Promise<ClangFormatConfig> {
    return this.files.read()
  }

  save(yaml: string): Promise<ClangFormatConfig> {
    return this.files.save(yaml)
  }

  reset(): Promise<ClangFormatConfig> {
    return this.files.reset()
  }

  async importConfig(): Promise<ClangFormatImportResult> {
    const options: OpenDialogOptions = {
      title: 'Import .clang-format',
      properties: ['openFile'],
      filters: [
        { name: 'clang-format configuration', extensions: ['clang-format', 'yaml', 'yml'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = await dialog.showOpenDialog(options)
    const sourcePath = result.filePaths[0]
    if (result.canceled || !sourcePath) return null
    try {
      return {
        yaml: validateYaml(await readFile(sourcePath, 'utf8')),
        fileName: sourcePath.split('/').at(-1) ?? '.clang-format'
      }
    } catch (error) {
      throw storageError('The selected clang-format file is not valid YAML.', error)
    }
  }

  async exportConfig(yaml: string): Promise<ClangFormatExportResult> {
    const validated = validateYaml(yaml)
    const options: SaveDialogOptions = {
      title: 'Export .clang-format',
      defaultPath: join(dirname(this.filePath), '.clang-format'),
      filters: [
        { name: 'clang-format configuration', extensions: ['clang-format'] },
        { name: 'YAML', extensions: ['yaml', 'yml'] }
      ]
    }
    const result = await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) {
      return { saved: false, fileName: null }
    }
    try {
      await this.files.writeTo(result.filePath, validated)
      return {
        saved: true,
        fileName: result.filePath.split('/').at(-1) ?? extname(result.filePath)
      }
    } catch (error) {
      throw storageError('The clang-format configuration could not be exported.', error)
    }
  }
}
