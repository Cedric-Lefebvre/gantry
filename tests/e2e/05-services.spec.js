import { navigateTo, waitForLoad } from './helpers.js'

describe('Services Page', () => {
  before(async () => {
    await navigateTo('Services')
    await waitForLoad()
  })

  it('should list services', async () => {
    const text = await (await $('body')).getText()
    expect(text.length).toBeGreaterThan(100)
    expect(text).not.toMatch(/no services/i)
  })

  it('should have a search input', async () => {
    await expect(await $('input[placeholder*="Search"]')).toBeDisplayed()
  })

  it('should show well-known services', async () => {
    const text = await (await $('body')).getText()
    expect(text).toMatch(/NetworkManager|ssh|cron|dbus|systemd/i)
  })

  it('should filter services on search', async () => {
    const searchInput = await $('input[placeholder*="Search"]')
    await searchInput.clearValue()
    await searchInput.setValue('dbus')
    await browser.pause(500)

    expect(await (await $('body')).getText()).toMatch(/dbus/i)

    await searchInput.clearValue()
    await browser.pause(300)
  })

  it('should have a System tab button', async () => {
    await expect(await $('button=System')).toBeDisplayed()
  })
})
