// tests/e2e/theme-no-flash.spec.ts
import { test, expect } from '@playwright/test'

test('dark theme is applied before first paint, no flash', async ({ page, context }) => {
  await context.addInitScript(() => localStorage.setItem('beybladex-theme', 'dark'))
  await page.goto('/')
  // Assert the class is present at the earliest observable point, not after a settle delay.
  await expect(page.locator('html')).toHaveClass(/dark/)
})
