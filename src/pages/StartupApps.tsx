import React, { useEffect, useState } from 'react'
import { listStartupApps } from '../api/config'

interface StartupApp {
  name?: string
  file?: string
  exec?: string
}

export default function StartupApps() {
  const [startupApps, setStartupApps] = useState<StartupApp[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchStartupApplications()
  }, [])

  const fetchStartupApplications = async () => {
    try {
      const data = await listStartupApps()
      setStartupApps(Array.isArray(data) ? data : [])
    } catch (err) {
      setStartupApps([])
    } finally {
      setIsLoading(false)
    }
  }

  if (isLoading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading startup apps…</div>

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Startup Applications</h1>
      {startupApps.length === 0 ? (
        <p className="text-gray-600 dark:text-gray-400">No autostart entries found.</p>
      ) : (
        <div className="grid gap-4">
          {startupApps.map((app) => (
            <div key={app.file || app.name || app.exec} className="bg-white dark:bg-gray-800 rounded p-4 border border-gray-200 dark:border-gray-700">
              <p className="font-semibold text-gray-900 dark:text-gray-100">{app.name || app.file}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">{app.exec}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
