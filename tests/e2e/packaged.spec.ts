import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
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

test('the packaged editor supports Vim and offline C++ formatting', async () => {
  test.skip(!existsSync(executablePath), 'Run yarn package:dir before the packaged editor test.')
  const userDataDirectory = await mkdtemp(resolve(tmpdir(), 'leetcode-packaged-editor-'))
  const application = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDirectory}`]
  })

  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: /Search problems/ }).first().click()
    await page.getByRole('combobox').fill('minimum size subarray sum')
    const result = page.getByRole('option').filter({ hasText: '209' }).first()
    await result.waitFor({ timeout: 20_000 })
    await result.click()
    await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 })

    await page.getByRole('button', { name: 'Vim', exact: true }).click()
    await expect(page.locator('.vim-statusbar')).toContainText('NORMAL')
    const editorInput = page.locator('.monaco-editor textarea').first()
    await editorInput.click({ force: true })
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    await page.keyboard.press('o')
    await expect(page.locator('.vim-statusbar')).toContainText('INSERT')
    await page.keyboard.insertText('// packaged vim line')
    await page.keyboard.press('Escape')
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(
      '// packaged vim line'
    )
    await page.getByRole('button', { name: 'Standard', exact: true }).click()

    await editorInput.click({ force: true })
    await page.keyboard.press('Meta+A')
    await page.keyboard.insertText(
      'class Solution{public:int solve(vector<int>& nums){int total=0;return total;}};'
    )
    await application.evaluate(({ session }) => {
      session.defaultSession.enableNetworkEmulation({ offline: true })
    })
    await page.getByRole('button', { name: 'Format C++ document' }).click()
    await page.waitForTimeout(1_500)
    await application.evaluate(({ session }) => {
      session.defaultSession.enableNetworkEmulation({ offline: false })
    })
    const formatted = (await page.locator('.monaco-editor .view-lines').first().innerText()).replaceAll(
      '\u00a0',
      ' '
    )
    expect(formatted).toContain('class Solution {')
    expect(formatted).toContain('int total = 0;')
  } finally {
    await application.close().catch(() => undefined)
    await rm(userDataDirectory, { recursive: true, force: true })
  }
})
