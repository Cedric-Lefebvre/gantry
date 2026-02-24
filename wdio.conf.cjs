const { spawn } = require('child_process')
const path = require('path')
const os = require('os')

// The actual Gantry binary (run `npm run tauri:build` first)
const binaryPath = path.resolve(__dirname, 'target', 'release', 'gantry')

// The tauri-driver binary installed via: cargo install tauri-driver
const tauriDriverBin = path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver')

// Env that enables webkit2gtk WebDriver automation
const automationEnv = {
  ...process.env,
  TAURI_WEBVIEW_AUTOMATION: 'true',
  GDK_BACKEND: 'x11',
}

let tauriDriver

exports.config = {
  specs: ['./tests/e2e/**/*.spec.js'],
  exclude: [],

  maxInstances: 1,

  hostname: 'localhost',
  port: 4444,
  path: '/',

  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': { application: binaryPath },
    },
  ],

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 30000,
  connectionRetryCount: 1,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  // Start a single tauri-driver instance before any workers spin up
  onPrepare: async () => {
    tauriDriver = spawn(tauriDriverBin, [], {
      stdio: [null, process.stdout, process.stderr],
      env: automationEnv,
    })
    // Give tauri-driver time to bind its port before workers start
    await new Promise(resolve => setTimeout(resolve, 2000))
  },

  // Kill tauri-driver after all workers have finished
  onComplete: () => {
    if (tauriDriver) tauriDriver.kill()
  },
}
