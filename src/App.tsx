import { useState, useEffect, Suspense, lazy } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import Layout from './components/Layout'
import Settings from './pages/Settings'
import Devices from './pages/Devices'
import Processes from './pages/Processes'
import Repositories from './pages/Repositories'
import StartupApps from './pages/StartupApps'
import Resources from './pages/Resources'
import Logs from './pages/Logs'
import Scripts from './pages/Scripts'
import { PageType } from './types'
import { DEFAULT_PAGE } from './constants'

// Lazy load Services to prevent blocking page navigation
const Services = lazy(() => import('./pages/Services'))

interface AppSettings {
  theme: string
}

function App() {
  const [currentPage, setCurrentPage] = useState<PageType>(DEFAULT_PAGE)
  const [themeLoaded, setThemeLoaded] = useState(false)

  useEffect(() => {
    loadTheme()
  }, [])

  const loadTheme = async () => {
    try {
      const settings = await invoke<AppSettings>('get_settings')
      applyTheme(settings.theme)
    } catch (err) {
      // Fallback to localStorage
      const saved = localStorage.getItem('theme')
      applyTheme(saved || 'light')
    } finally {
      setThemeLoaded(true)
    }
  }

  const applyTheme = (theme: string) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'settings':
        return <Settings />
      case 'devices':
        return <Devices />
      case 'processes':
        return <Processes />
      case 'repositories':
        return <Repositories />
      case 'startup':
        return <StartupApps />
      case 'resources':
        return <Resources />
      case 'logs':
        return <Logs />
      case 'scripts':
        return <Scripts />
      case 'services':
        return (
          <Suspense fallback={
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Services</h1>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="px-4 py-16">
                  <div className="flex flex-col items-center justify-center gap-4">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-gray-500 dark:text-gray-400">Loading services...</p>
                  </div>
                </div>
              </div>
            </div>
          }>
            <Services />
          </Suspense>
        )
      default:
        return <Devices />
    }
  }

  // Don't render until theme is loaded to prevent flash
  if (!themeLoaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50 dark:bg-gray-900">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <Layout currentPage={currentPage} onPageChange={setCurrentPage}>
      {renderPage()}
    </Layout>
  )
}

export default App
