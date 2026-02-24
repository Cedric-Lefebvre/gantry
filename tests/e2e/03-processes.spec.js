import { navigateTo, waitForLoad } from './helpers.js'

describe('Processes Page', () => {
  before(async () => {
    await navigateTo('Processes')
    await waitForLoad()
  })

  it('should list at least one process', async () => {
    const text = await (await $('body')).getText()
    expect(text.length).toBeGreaterThan(100)
    expect(text).not.toMatch(/no processes/i)
  })

  it('should show CPU and memory columns', async () => {
    const text = await (await $('body')).getText()
    expect(text).toMatch(/cpu/i)
    expect(text).toMatch(/memory|mem/i)
  })

  it('should have a search input', async () => {
    await expect(await $('input[placeholder*="Search"]')).toBeDisplayed()
  })

  it('should filter processes on search', async () => {
    const searchInput = await $('input[placeholder*="Search"]')
    await searchInput.clearValue()
    await searchInput.setValue('systemd')
    await browser.pause(500)

    expect(await (await $('body')).getText()).toMatch(/systemd/i)

    await searchInput.clearValue()
    await browser.pause(300)
  })

  it('should have a Refresh button', async () => {
    await expect(await $('button=Refresh')).toBeDisplayed()
  })
})
