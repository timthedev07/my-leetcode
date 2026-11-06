import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

type RunningApp = {
  application: ElectronApplication
  page: Page
  userDataDirectory: string
}

async function launchApplication(existingDirectory?: string): Promise<RunningApp> {
  const userDataDirectory =
    existingDirectory ?? (await mkdtemp(join(tmpdir(), 'leetcode-editor-e2e-')))
  const application = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`],
    cwd: process.cwd()
  })
  const page = await application.firstWindow()
  await page.getByRole('heading', { name: 'No problem open' }).waitFor({ timeout: 15_000 })
  return { application, page, userDataDirectory }
}

async function openProblem(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Search problems/ }).first().click()
  await page.getByRole('combobox').fill('minimum size subarray sum')
  const result = page.getByRole('option').filter({ hasText: '209' }).first()
  await result.waitFor({ timeout: 20_000 })
  await result.click()
  await page.locator('.monaco-editor').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(300)
}

async function readEditorClipboard(app: RunningApp): Promise<string> {
  const standard = app.page.getByRole('button', { name: 'Standard', exact: true })
  if ((await standard.getAttribute('aria-pressed')) !== 'true') await standard.click()
  await app.page.waitForTimeout(150)
  const input = app.page.locator('.monaco-editor textarea').first()
  await input.click({ force: true })
  await app.page.keyboard.press('Meta+A')
  await app.page.keyboard.press('Meta+C')
  return app.application.evaluate(({ clipboard }) => clipboard.readText())
}

async function readVisibleEditorText(page: Page): Promise<string> {
  return (await page.locator('.monaco-editor .view-lines').first().innerText()).replaceAll('\u00a0', ' ')
}

test.describe('editor workflows', () => {
  test('Vim edits, toggles without data loss and persists across restart', async () => {
    let app = await launchApplication()
    const userDataDirectory = app.userDataDirectory

    try {
      await openProblem(app.page)
      const original = await readEditorClipboard(app)
      await expect(app.page.getByRole('button', { name: 'Standard', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await app.page.getByRole('button', { name: 'Vim', exact: true }).click()
      await expect(app.page.locator('.vim-statusbar')).toContainText('NORMAL')

      const input = app.page.locator('.monaco-editor textarea').first()
      await input.click({ force: true })
      await app.page.keyboard.press('g')
      await app.page.keyboard.press('g')
      await app.page.keyboard.press('o')
      await expect(app.page.locator('.vim-statusbar')).toContainText('INSERT')
      await app.page.keyboard.insertText('// opened line')
      const openedLineText = await readEditorClipboard(app)
      expect(openedLineText).toMatch(
        /^class Solution \{\n[ \t]*\/\/ opened line/m
      )
      await app.page.keyboard.press('Escape')
      await expect(app.page.locator('.vim-statusbar')).toContainText('NORMAL')
      await expect(app.page.locator('.monaco-editor .view-lines').first()).toContainText('// opened line')
      await app.page.keyboard.press('v')
      await expect(app.page.locator('.vim-statusbar')).toContainText('VISUAL')
      await app.page.keyboard.press('Escape')
      await app.page.keyboard.press('V')
      await expect(app.page.locator('.vim-statusbar')).toContainText('VISUAL LINE')
      await app.page.keyboard.press('Escape')
      await app.page.keyboard.type('/Solution', { delay: 20 })
      await app.page.keyboard.press('Enter')
      await expect(app.page.locator('.vim-statusbar')).toContainText('NORMAL')
      await app.page.keyboard.press('i')
      await expect(app.page.locator('.vim-statusbar')).toContainText('INSERT')
      await app.page.keyboard.type('// vim e2e ', { delay: 25 })
      await app.page.keyboard.press('Escape')
      await expect(app.page.locator('.vim-statusbar')).toContainText('NORMAL')

      await app.page.keyboard.press('Meta+K')
      await expect(app.page.getByRole('combobox')).toBeVisible()
      await app.page.keyboard.press('Escape')

      const edited = await readEditorClipboard(app)
      expect(edited).toContain('// vim e2e')
      expect(edited).not.toBe(original)
      await expect(app.page.getByText('Saved', { exact: true })).toBeVisible({ timeout: 10_000 })
      await expect(app.page.locator('.vim-statusbar')).toBeHidden()

      await app.page.getByRole('button', { name: 'Vim', exact: true }).click()
      await app.application.close()
      app = await launchApplication(userDataDirectory)
      await openProblem(app.page)
      await expect(app.page.getByRole('button', { name: 'Vim', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(app.page.locator('.vim-statusbar')).toContainText('NORMAL')
    } finally {
      await app.application.close().catch(() => undefined)
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })

  test('formats offline, preserves undo and persists the selected configuration', async () => {
    let app = await launchApplication()
    const userDataDirectory = app.userDataDirectory

    try {
      await app.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settingsDialog = app.page.getByRole('dialog')
      await expect(settingsDialog).toBeVisible()
      const yaml = settingsDialog.getByLabel('Configuration YAML')
      await expect(settingsDialog.getByText('Configuration valid')).toBeVisible({ timeout: 10_000 })
      const customConfiguration = `---
BasedOnStyle: LLVM
IndentWidth: 8
TabWidth: 8
UseTab: Never
ColumnLimit: 100
BreakBeforeBraces: Attach
PointerAlignment: Left
SortIncludes: Never
`
      await yaml.fill(customConfiguration)
      await expect(settingsDialog.getByText('Configuration valid')).toBeVisible({ timeout: 10_000 })
      await settingsDialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(app.page.getByText('Formatting configuration saved.')).toBeVisible()
      await app.page.getByRole('button', { name: 'Close', exact: true }).click()

      await openProblem(app.page)
      const input = app.page.locator('.monaco-editor textarea').first()
      await input.click({ force: true })
      await app.page.keyboard.press('Meta+A')
      await app.page.keyboard.insertText('void solve() {')
      await app.page.keyboard.press('Enter')
      await app.page.keyboard.insertText('// note')
      await app.page.keyboard.press('Enter')
      await app.page.keyboard.insertText('continued')
      const smartEnterText = await readEditorClipboard(app)
      expect(smartEnterText).toContain(
        'void solve() {\n        // note\n        // continued'
      )

      await input.click({ force: true })
      await app.page.keyboard.press('Meta+A')
      const original =
        'class Solution{public:int solve(vector<int>& nums){int total=0;for(int x:nums){total+=x;}return total;}};'
      await app.page.keyboard.insertText(original)

      await app.page.getByRole('button', { name: 'Vim', exact: true }).click()
      await input.click({ force: true })
      await app.page.keyboard.press('Meta+K')
      await expect(app.page.getByRole('combobox')).toBeVisible()
      await app.page.keyboard.press('Escape')

      await app.application.evaluate(({ session }) => {
        session.defaultSession.enableNetworkEmulation({ offline: true })
      })
      await app.page.keyboard.press('Alt+Shift+F')
      await app.page.waitForTimeout(1_500)
      await app.application.evaluate(({ session }) => {
        session.defaultSession.enableNetworkEmulation({ offline: false })
      })

      await app.page.getByRole('button', { name: 'Standard', exact: true }).click()
      await app.page.waitForTimeout(150)
      await expect(app.page.locator('.vim-statusbar')).toBeHidden()
      const formatted = await readVisibleEditorText(app.page)
      expect(formatted).toContain('class Solution {')
      expect(formatted).toMatch(/^ {8,}int total = 0;$/m)
      await expect(app.page.getByText('Saved', { exact: true })).toBeVisible()
      await app.page.locator('.monaco-editor').first().click({ position: { x: 100, y: 40 } })
      await app.page.keyboard.press('Meta+z')
      await app.page.waitForTimeout(200)
      expect(await readVisibleEditorText(app.page)).toContain('class Solution{public:int solve')

      await app.page.getByRole('button', { name: 'Format C++ document' }).click()
      await app.page.waitForTimeout(1_000)
      const formattedOnce = await readVisibleEditorText(app.page)
      await app.page.getByRole('button', { name: 'Format C++ document' }).click()
      await app.page.waitForTimeout(1_000)
      expect(await readVisibleEditorText(app.page)).toBe(formattedOnce)

      await app.application.close()
      app = await launchApplication(userDataDirectory)
      await app.page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(app.page.getByLabel('Configuration YAML')).toHaveValue(customConfiguration)
    } finally {
      await app.application.close().catch(() => undefined)
      await rm(userDataDirectory, { recursive: true, force: true })
    }
  })
})
