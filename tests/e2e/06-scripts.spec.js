import { waitForLoad, waitForText } from './helpers.js'

const TEST_SCRIPT_NAME = 'E2E Test Script'
const TEST_PROMPT_NAME = 'E2E Prompt Script'

// Click an element found by XPath using React's internal props (React 17+ stores
// current props on __reactProps$<hash> keys of managed DOM nodes).
// Bypasses WebDriver hit-test checks — runs entirely as in-page JS.
async function jsClickByXPath(xpath) {
  const result = await browser.execute((xp) => {
    const el = document.evaluate(
      xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
    ).singleNodeValue
    if (!el) return 'not_found'
    el.scrollIntoView({ block: 'center' })
    // React 17+ attaches props to __reactProps$<hash> on each managed DOM node
    const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps'))
    if (propsKey && typeof el[propsKey]?.onClick === 'function') {
      el[propsKey].onClick({ preventDefault: () => {}, stopPropagation: () => {} })
      return 'react_props'
    }
    // Fallback: bubbling MouseEvent (still triggers React event delegation)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    return 'mouse_event'
  }, xpath)
  if (result === 'not_found') throw new Error(`jsClickByXPath: no element for: ${xpath}`)
}

// Build XPaths scoped to the card whose <h3> matches `name`
function cardBtnXPath(name, btnText) {
  return `//h3[normalize-space()="${name}"]/ancestor::div[contains(@class,"rounded-xl")]//button[normalize-space()="${btnText}"]`
}
function cardDeleteXPath(name) {
  return `//h3[normalize-space()="${name}"]/ancestor::div[contains(@class,"rounded-xl")]//*[@title="Delete script"]`
}

// Scoped delete: click trash → confirm dialog → click Delete in modal
async function deleteScriptCard(name) {
  await jsClickByXPath(cardDeleteXPath(name))
  // Wait for the confirmation dialog
  const confirmBtn = await $(
    '//div[contains(@class,"fixed") and contains(@class,"inset-0")]//button[@title="Confirm delete"]'
  )
  await confirmBtn.waitForDisplayed({ timeout: 5000 })
  await confirmBtn.click()
}

// Convenience: verify the element exists/visible before returning it
async function waitForCardBtn(name, btnText) {
  const btn = await $(cardBtnXPath(name, btnText))
  await btn.waitForDisplayed({ timeout: 5000 })
  return btn
}

async function goToScripts() {
  const btn = await $('button=Scripts')
  await btn.waitForDisplayed({ timeout: 5000 })
  await btn.click()
  const heading = await $('h1=Custom Scripts')
  await heading.waitForDisplayed({ timeout: 10000 })
  await waitForLoad()
}

describe('Scripts Page — CRUD + Run', () => {
  before(async () => {
    await goToScripts()
  })

  it('should show the Scripts page', async () => {
    await expect(await $('h1=Custom Scripts')).toBeDisplayed()
  })

  it('should have an Add Script button', async () => {
    await expect(await $('button=Add Script')).toBeDisplayed()
  })

  describe('Add a script', () => {
    before(async () => {
      await (await $('button=Add Script')).click()
    })

    it('should open the Add Script modal', async () => {
      const modal = await $('h2=Add Custom Script')
      await modal.waitForDisplayed({ timeout: 5000 })
      await expect(modal).toBeDisplayed()
    })

    it('should fill in name and command', async () => {
      const nameInput = await $('input[placeholder*="Shutdown Timer"]')
      await nameInput.clearValue()
      await nameInput.setValue(TEST_SCRIPT_NAME)

      const commandInput = await $('textarea[placeholder*="shutdown"]')
      await commandInput.clearValue()
      await commandInput.setValue('echo e2e_test_ran_ok')
    })

    it('should submit and show the new script card', async () => {
      const addBtns = await $$('button=Add Script')
      await addBtns[addBtns.length - 1].click()

      await browser.waitUntil(
        async () => (await (await $('body')).getText()).includes(TEST_SCRIPT_NAME),
        { timeout: 10000, timeoutMsg: 'New script card did not appear' }
      )
    })
  })

  describe('Run a script', () => {
    it('should run only the E2E test script and show output', async () => {
      // JS click scoped to the specific card — never touches any other script
      await jsClickByXPath(cardBtnXPath(TEST_SCRIPT_NAME, 'Run'))

      await waitForText('Terminal Output', 10000)
      await waitForText('e2e_test_ran_ok', 10000)
    })

    it('should show exit 0 in the terminal', async () => {
      expect(await (await $('body')).getText()).toContain('exit 0')
    })

    it('should clear the terminal panel', async () => {
      const clearBtn = await $('button=Clear')
      await clearBtn.waitForDisplayed({ timeout: 5000 })
      await clearBtn.click()
      await browser.waitUntil(
        async () => !(await (await $('body')).getText()).includes('Terminal Output'),
        { timeout: 5000, timeoutMsg: 'Terminal panel did not clear' }
      )
    })
  })

  describe('Delete the test script', () => {
    it('should delete only the E2E Test Script card', async () => {
      await deleteScriptCard(TEST_SCRIPT_NAME)

      await browser.waitUntil(
        async () => !(await (await $('body')).getText()).includes(TEST_SCRIPT_NAME),
        { timeout: 10000, timeoutMsg: 'Script was not deleted' }
      )
    })
  })

  describe('Script with prompts', () => {
    it('should create a script with a {name} prompt variable', async () => {
      await (await $('button=Add Script')).click()
      await (await $('h2=Add Custom Script')).waitForDisplayed({ timeout: 5000 })

      await (await $('input[placeholder*="Shutdown Timer"]')).setValue(TEST_PROMPT_NAME)
      await (await $('textarea[placeholder*="shutdown"]')).setValue('echo hello {name}')

      await (await $('button*=Add prompt')).click()
      await (await $('input[placeholder="variable"]')).setValue('name')
      await (await $('input[placeholder*="Label shown"]')).setValue('Your name')

      const addBtns = await $$('button=Add Script')
      await addBtns[addBtns.length - 1].click()

      await browser.waitUntil(
        async () => (await (await $('body')).getText()).includes(TEST_PROMPT_NAME),
        { timeout: 5000, timeoutMsg: 'Prompt script card did not appear' }
      )
    })

    it('should show Run… button on the prompt script card', async () => {
      const btn = await waitForCardBtn(TEST_PROMPT_NAME, 'Run…')
      await expect(btn).toBeDisplayed()
    })

    it('should open prompt dialog, fill it, and run', async () => {
      // Open the prompt dialog
      await jsClickByXPath(cardBtnXPath(TEST_PROMPT_NAME, 'Run…'))
      await (await $('h2*=Run —')).waitForDisplayed({ timeout: 5000 })

      const promptInput = await $('input.font-mono')
      await promptInput.setValue('world')

      // Scope "Run" to the fixed modal overlay so we don't pick a card's Run button
      const modalRunBtn = await $(
        '//div[contains(@class,"fixed") and contains(@class,"inset-0")]//button[normalize-space()="Run"]'
      )
      await modalRunBtn.waitForDisplayed({ timeout: 5000 })
      await modalRunBtn.click()

      await waitForText('hello world', 10000)

      // Clear the terminal so it doesn't block further interactions
      const clearBtn = await $('button=Clear')
      await clearBtn.waitForDisplayed({ timeout: 5000 })
      await clearBtn.click()
      await browser.waitUntil(
        async () => !(await (await $('body')).getText()).includes('Terminal Output'),
        { timeout: 5000, timeoutMsg: 'Terminal panel did not clear' }
      )
    })

    it('should clean up the prompt script card', async () => {
      await deleteScriptCard(TEST_PROMPT_NAME)

      await browser.waitUntil(
        async () => !(await (await $('body')).getText()).includes(TEST_PROMPT_NAME),
        { timeout: 10000, timeoutMsg: 'Prompt script was not deleted' }
      )
    })
  })
})
