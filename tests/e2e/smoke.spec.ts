import { _electron as electron, expect, test } from '@playwright/test'

test('the secure Electron shell launches', async () => {
  const application = await electron.launch({
    args: ['.'],
    cwd: process.cwd()
  })

  try {
    const page = await application.firstWindow()
    await expect(page).toHaveTitle('LeetCode Desktop')
    await expect(page.getByRole('heading', { name: 'No problem open' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search problems' }).first()).toBeVisible()

    const isolation = await page.evaluate(() => ({
      hasDesktopBridge: typeof (globalThis as typeof globalThis & { desktop?: unknown }).desktop === 'object',
      hasNodeRequire: typeof (globalThis as typeof globalThis & { require?: unknown }).require !== 'undefined',
      hasProcess: typeof (globalThis as typeof globalThis & { process?: unknown }).process !== 'undefined'
    }))

    expect(isolation).toEqual({
      hasDesktopBridge: true,
      hasNodeRequire: false,
      hasProcess: false
    })
  } finally {
    await application.close()
  }
})
