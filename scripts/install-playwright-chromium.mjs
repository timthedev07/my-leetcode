import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const browsersPath = resolve(process.cwd(), 'resources', 'playwright')
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath

if (existsSync(chromium.executablePath())) {
  console.log(`Playwright Chromium is already installed at ${browsersPath}.`)
  process.exit(0)
}

console.log(`Installing Playwright Chromium into ${browsersPath}...`)
const result = spawnSync('yarn', ['playwright', 'install', 'chromium'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath
  },
  stdio: 'inherit'
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}
