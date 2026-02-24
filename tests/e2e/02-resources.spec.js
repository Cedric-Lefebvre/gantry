import { navigateTo, waitForLoad } from './helpers.js'

describe('Resources Page', () => {
  before(async () => {
    await navigateTo('Resources')
    await waitForLoad()
  })

  it('should display CPU usage', async () => {
    expect(await (await $('body')).getText()).toMatch(/cpu/i)
  })

  it('should display memory usage', async () => {
    expect(await (await $('body')).getText()).toMatch(/memory|mem/i)
  })

  it('should display uptime', async () => {
    expect(await (await $('body')).getText()).toMatch(/uptime/i)
  })

  it('should show disk information', async () => {
    expect(await (await $('body')).getText()).toMatch(/disk|storage|GB|TB/i)
  })
})
