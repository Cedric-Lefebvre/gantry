import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Palette } from 'lucide-react'
import { AppSettings } from '../types'
import { applyTheme } from '../utils/theme'

type Theme = 'light' | 'dark'

export default function Settings() {
  const [theme, setTheme] = useState<Theme>('light')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settings = await invoke<AppSettings>('get_settings')
      const savedTheme = settings.theme === 'dark' ? 'dark' : 'light'
      setTheme(savedTheme)
      applyTheme(savedTheme)
    } catch (err) {
      console.error('Failed to load settings:', err)
      const saved = localStorage.getItem('theme')
      const fallbackTheme = saved === 'dark' ? 'dark' : 'light'
      setTheme(fallbackTheme)
      applyTheme(fallbackTheme)
    } finally {
      setLoading(false)
    }
  }

  const handleThemeChange = async (newTheme: Theme) => {
    setTheme(newTheme)
    applyTheme(newTheme)

    localStorage.setItem('theme', newTheme)

    try {
      await invoke('set_theme', { theme: newTheme })
    } catch (err) {
      console.error('Failed to save theme:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100">Settings</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-2">Manage your application preferences</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Palette size={24} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Appearance</h2>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Theme
          </label>
          <select
            value={theme}
            onChange={(e) => handleThemeChange(e.target.value as Theme)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-gray-900"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4 text-sm text-gray-600 dark:text-gray-400">
        Settings are saved to <code className="bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded text-xs">~/.gantry/settings.yaml</code>
      </div>
    </div>
  )
}
