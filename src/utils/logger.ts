import { writeLog as writeLogToFile } from '../api/logging'

const LOG_KEY = 'gantry_logs'
const MAX_LOGS = 500

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
  data?: unknown
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

function getLogs(): LogEntry[] {
  try {
    const stored = localStorage.getItem(LOG_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveLogs(logs: LogEntry[]): void {
  try {
    const trimmed = logs.slice(-MAX_LOGS)
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.error('Failed to save logs', e)
  }
}

function safeStringify(data: unknown): string {
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function logMessage(level: LogLevel, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: formatTimestamp(),
    level,
    message,
    data,
  }

  const logs = getLogs()
  logs.push(entry)
  saveLogs(logs)

  const dataStr = data !== undefined ? ` | ${safeStringify(data)}` : ''
  const fileLogMessage = `[${level.toUpperCase()}] ${message}${dataStr}`

  const consoleMethod = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  console[consoleMethod as 'log' | 'warn' | 'error'](
    `[${level.toUpperCase()}] ${message}`,
    data ?? ''
  )

  writeLogToFile(fileLogMessage).catch(() => {})
}

export const logger = {
  info: (message: string, data?: unknown) => logMessage('info', message, data),
  warn: (message: string, data?: unknown) => logMessage('warn', message, data),
  error: (message: string, data?: unknown) => logMessage('error', message, data),
  debug: (message: string, data?: unknown) => logMessage('debug', message, data),
  getLogs: getLogs,
  clearLogs: () => {
    localStorage.setItem(LOG_KEY, JSON.stringify([]))
  },
}
