import { navigateTo, waitForLoad } from './helpers.js'

describe('Navigation', () => {
  it('should launch and show the app', async () => {
    const sidebar = await $('aside')
    await sidebar.waitForDisplayed({ timeout: 10000 })
    await expect(sidebar).toBeDisplayed()
  })

  it('should show all nav items in the sidebar', async () => {
    const labels = ['Resources', 'Devices', 'Processes', 'Services', 'Repositories', 'Scripts', 'Logs', 'Settings']
    for (const label of labels) {
      const btn = await $(`button=${label}`)
      await expect(btn).toBeDisplayed()
    }
  })

  it('should navigate to Resources page', async () => {
    await navigateTo('Resources')
    await waitForLoad()
  })

  it('should navigate to Processes page', async () => {
    await navigateTo('Processes')
    await waitForLoad()
  })

  it('should navigate to Services page', async () => {
    await navigateTo('Services')
    await waitForLoad()
  })

  it('should navigate to Devices page', async () => {
    await navigateTo('Devices')
    await waitForLoad()
  })

  it('should navigate to Repositories page', async () => {
    await navigateTo('Repositories')
    await waitForLoad()
  })

  it('should navigate to Scripts page', async () => {
    await navigateTo('Scripts')
    await waitForLoad()
  })

  it('should navigate to Logs page', async () => {
    await navigateTo('Logs')
    await waitForLoad()
  })

  it('should navigate to Settings page', async () => {
    await navigateTo('Settings')
    await waitForLoad()
  })

  it('should highlight the active nav item', async () => {
    await navigateTo('Processes')
    const activeBtn = await $('button=Processes')
    const classes = await activeBtn.getAttribute('class')
    expect(classes).toContain('bg-blue-600')
  })
})
