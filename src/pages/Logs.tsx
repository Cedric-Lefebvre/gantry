import { useEffect, useState } from 'react'
import { logger } from '../utils/logger'
import { readLogFile, clearLogFile } from '../api/logging'
import { Trash2, RefreshCw, Download } from 'lucide-react'

interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  data?: unknown
}

type LogLevel = 'all' | 'error' | 'warn' | 'info'
type ViewMode = 'browser' | 'file'

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [fileLogs, setFileLogs] = useState<string>('')
  const [activeLogLevel, setActiveLogLevel] = useState<LogLevel>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('file')
  const [isLoadingFileLogs, setIsLoadingFileLogs] = useState(false)

  useEffect(() => {
    loadBrowserLogs()
    loadFileLogsFromDisk()

    const autoRefreshInterval = setInterval(loadFileLogsFromDisk, 3000)
    return () => clearInterval(autoRefreshInterval)
  }, [])

  const loadBrowserLogs = () => {
    setLogs(logger.getLogs())
  }

  const loadFileLogsFromDisk = async () => {
    setIsLoadingFileLogs(true)
    try {
      const content = await readLogFile()
      setFileLogs(String(content))
    } catch (err) {
      setFileLogs(`Error reading log file: ${err}`)
    } finally {
      setIsLoadingFileLogs(false)
    }
  }

  const refreshCurrentView = () => {
    if (viewMode === 'file') {
      loadFileLogsFromDisk()
    } else {
      loadBrowserLogs()
    }
  }

  const clearCurrentLogs = async () => {
    if (viewMode === 'browser') {
      logger.clearLogs()
      setLogs([])
    } else {
      await clearLogFile()
      setFileLogs('')
    }
  }

  const downloadLogsAsFile = () => {
    const blob = new Blob([fileLogs], { type: 'text/plain' })
    const downloadLink = document.createElement('a')
    downloadLink.href = URL.createObjectURL(blob)
    downloadLink.download = `gantry-${new Date().toISOString().split('T')[0]}.log`
    document.body.appendChild(downloadLink)
    downloadLink.click()
    document.body.removeChild(downloadLink)
  }

  const getLogLevelColor = (level: string): string => {
    switch (level) {
      case 'error':
        return 'bg-red-100 text-red-700'
      case 'warn':
        return 'bg-yellow-100 text-yellow-700'
      case 'info':
        return 'bg-blue-100 text-blue-700'
      case 'debug':
        return 'bg-gray-100 text-gray-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getFilteredBrowserLogs = (): LogEntry[] => {
    return logs.filter(log => activeLogLevel === 'all' || log.level === activeLogLevel)
  }

  const fileLogLineCount = fileLogs.split('\n').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Logs</h1>
        <div className="flex gap-2">
          <button
            onClick={refreshCurrentView}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {viewMode === 'file' && (
            <button
              onClick={downloadLogsAsFile}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition"
            >
              <Download size={16} />
              Download
            </button>
          )}
          <button
            onClick={clearCurrentLogs}
            className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition"
          >
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setViewMode('file')}
          className={`px-4 py-2 border-b-2 transition ${
            viewMode === 'file'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          File Logs ({fileLogLineCount} lines)
        </button>
        <button
          onClick={() => setViewMode('browser')}
          className={`px-4 py-2 border-b-2 transition ${
            viewMode === 'browser'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-semibold'
              : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          Browser Storage ({logs.length} entries)
        </button>
      </div>

      {viewMode === 'file' ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          {isLoadingFileLogs ? (
            <div className="p-4 text-gray-900 dark:text-gray-100">Loading file logs…</div>
          ) : fileLogs ? (
            <pre className="p-4 text-xs overflow-auto max-h-96 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-mono whitespace-pre-wrap break-words">
              {fileLogs}
            </pre>
          ) : (
            <div className="p-4 text-gray-600 dark:text-gray-400">No log file yet</div>
          )}
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            {(['all', 'error', 'warn', 'info'] as LogLevel[]).map((level) => (
              <button
                key={level}
                onClick={() => setActiveLogLevel(level)}
                className={`px-4 py-2 rounded-lg transition ${
                  activeLogLevel === level
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {level.charAt(0).toUpperCase() + level.slice(1)}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            {getFilteredBrowserLogs().length === 0 ? (
              <div className="p-4 text-gray-600 dark:text-gray-400">No logs to display</div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-gray-700 max-h-96 overflow-y-auto">
                {getFilteredBrowserLogs().map((log, i) => (
                  <div key={`${log.timestamp}-${i}`} className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition">
                    <div className="flex items-start gap-3">
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded whitespace-nowrap ${getLogLevelColor(log.level)}`}
                      >
                        {log.level.toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-mono text-gray-900 dark:text-gray-100">
                          {log.message}
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                          {log.timestamp}
                        </div>
                        {log.data !== undefined && (
                          <div className="text-xs text-gray-700 dark:text-gray-300 mt-2 bg-gray-50 dark:bg-gray-900 p-2 rounded font-mono overflow-auto max-h-32">
                            {typeof log.data === 'string'
                              ? log.data
                              : typeof log.data === 'object' && log.data !== null
                              ? JSON.stringify(log.data, null, 2)
                              : String(log.data)}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="text-sm text-gray-600 dark:text-gray-400">
            Showing {getFilteredBrowserLogs().length} of {logs.length} logs
          </div>
        </>
      )}

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          <strong>File Location:</strong> ~/.gantry/app.log
        </p>
        <p className="text-sm text-blue-700 dark:text-blue-400 mt-1">
          All app activity is logged to disk. Click "File Logs" tab to view or download.
        </p>
      </div>
    </div>
  )
}
