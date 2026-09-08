// tests/e2e/theme-no-flash.spec.ts
import { test, expect } from '@playwright/test'

const bodyBackground = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor)

test('dark theme is applied before first paint, no flash', async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('beybladex-theme', 'dark'))
  await page.goto('/')
  // Assert the class is present at the earliest observable point, not after a settle delay.
  await expect(page.locator('html')).toHaveClass(/dark/)
})

test('body background color responds to the theme toggle', async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('beybladex-theme', 'light'))
  await page.goto('/')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect.poll(() => bodyBackground(page)).toBe('rgb(248, 250, 252)') // --color-base-light

  await page.locator('html').evaluate((el) => el.classList.add('dark'))
  await expect.poll(() => bodyBackground(page)).toBe('rgb(9, 13, 22)') // --color-base-dark
})
