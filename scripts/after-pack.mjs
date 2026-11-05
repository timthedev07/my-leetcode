import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const APP_IDENTIFIER = 'com.timthedev.leetcodedesktop'

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const requirementsPath = join(context.packager.info.projectDir, 'build', 'requirements.mac')
  const requirements = (await readFile(requirementsPath, 'utf8')).trim()

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--identifier', APP_IDENTIFIER, appPath],
    { stdio: 'inherit' }
  )
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--identifier',
      APP_IDENTIFIER,
      '--requirements',
      requirements,
      appPath
    ],
    { stdio: 'inherit' }
  )
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
}
