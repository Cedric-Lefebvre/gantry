/**
 * Shared helpers for Gantry E2E tests.
 */

// Map nav button labels → actual h1 heading on that page
const PAGE_HEADINGS = {
  Repositories: 'APT Repositories',
  Scripts: 'Custom Scripts',
}

/** Click a nav item by its label text and wait for the page heading to appear. */
export async function navigateTo(label) {
  const btn = await $(`button=${label}`)
  await btn.waitForDisplayed({ timeout: 5000 })
  await btn.click()
  const heading = PAGE_HEADINGS[label] ?? label
  const h1 = await $(`h1=${heading}`)
  await h1.waitForDisplayed({ timeout: 10000 })
}

/** Wait until no spinning loader is visible on the page. */
export async function waitForLoad(timeout = 15000) {
  await browser.waitUntil(
    async () => {
      const spinners = await $$('[class*="animate-spin"]')
      return spinners.length === 0
    },
    { timeout, interval: 500, timeoutMsg: 'Page still loading after timeout' }
  )
}

/** Wait until the page body contains the given text. */
export async function waitForText(text, timeout = 15000) {
  await browser.waitUntil(
    async () => {
      const body = await $('body')
      const bodyText = await body.getText()
      return bodyText.includes(text)
    },
    { timeout, interval: 500, timeoutMsg: `Text "${text}" not found after timeout` }
  )
}
