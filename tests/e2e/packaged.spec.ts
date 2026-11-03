import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const executablePath = resolve(
  process.cwd(),
  'release',
  'mac-arm64',
  'LeetCode Desktop.app',
  'Contents',
  'MacOS',
  'LeetCode Desktop'
)

test('the packaged arm64 application launches with bundled resources', async () => {
  test.skip(!existsSync(executablePath), 'Run yarn package:dir before the packaged launch test.')

  const application = await electron.launch({ executablePath })

  try {
    const page = await application.firstWindow()
    await expect(page).toHaveTitle('LeetCode Desktop')
    await expect(page.getByRole('heading', { name: 'No problem open' })).toBeVisible()

    const packagedState = await application.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath
    }))
    expect(packagedState.isPackaged).toBe(true)
    expect(
      existsSync(resolve(packagedState.resourcesPath, 'playwright'))
    ).toBe(true)

    await page.getByRole('button', { name: 'Docs', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Getting Started' })).toBeVisible()
  } finally {
    await application.close()
  }
})
