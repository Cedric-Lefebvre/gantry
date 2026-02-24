import { navigateTo, waitForLoad } from './helpers.js'

describe('Devices Page', () => {
  before(async () => {
    await navigateTo('Devices')
    await waitForLoad()
  })

  it('should not crash and should show content', async () => {
    const text = await (await $('body')).getText()
    expect(text.length).toBeGreaterThan(50)
    expect(text).not.toMatch(/error|failed/i)
  })

  it('should show OS information', async () => {
    expect(await (await $('body')).getText()).toMatch(/hostname|kernel|linux/i)
  })

  it('should show Processor section', async () => {
    expect(await (await $('body')).getText()).toMatch(/processor|cpu/i)
  })

  it('should show Network Interfaces section', async () => {
    expect(await (await $('body')).getText()).toMatch(/network/i)
  })

  it('should show loopback interface', async () => {
    expect(await (await $('body')).getText()).toMatch(/\blo\b|loopback/i)
  })

  it('should have a filter search input', async () => {
    await expect(await $('input[placeholder*="Filter"]')).toBeDisplayed()
  })

  it('should have Collapse and Expand buttons', async () => {
    await expect(await $('button*=Collapse')).toBeDisplayed()
    await expect(await $('button*=Expand')).toBeDisplayed()
  })

  it('should collapse and expand sections', async () => {
    await (await $('button*=Collapse')).click()
    await browser.pause(300)
    await (await $('button*=Expand')).click()
    await browser.pause(300)
    expect(await (await $('body')).getText()).toMatch(/\blo\b|loopback/i)
  })
})
