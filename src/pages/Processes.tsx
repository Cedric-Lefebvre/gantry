import React, { useEffect, useState } from 'react'
import { listProcesses, killProcess } from '../api/processes'
import { logger } from '../utils/logger'
import { ChevronLeft, ChevronRight, Search, Trash2, X } from 'lucide-react'
import { Process, ProcessStatus } from '../types'
import { ITEMS_PER_PAGE } from '../constants'

export default function Processes() {
  const [processes, setProcesses] = useState<Process[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pendingDeletePid, setPendingDeletePid] = useState<number | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    fetchProcesses()
  }, [])

  const fetchProcesses = async () => {
    try {
      const data = await listProcesses()
      
      if (Array.isArray(data)) {
        const sorted = [...data].sort((a, b) => (b.memory || 0) - (a.memory || 0))
        setProcesses(sorted)
      } else {
        setProcesses([])
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      logger.error('Failed to load processes', { error: errorMessage })
      setError(errorMessage)
      setProcesses([])
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteProcess = async (pid: number) => {
    setIsDeleting(true)
    try {
      await killProcess(pid)
      await fetchProcesses()
      setPendingDeletePid(null)
    } catch (err) {
      logger.error('Failed to kill process', { pid, error: String(err) })
      alert(`Failed to kill process: ${err}`)
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.pid.toString().includes(searchQuery)
  )

  const resetSearch = () => {
    setSearchQuery('')
    setCurrentPage(1)
  }

  const formatProcessStatus = (status: ProcessStatus | undefined): string => {
    if (!status) return '—'
    if (typeof status === 'string') return status.substring(0, 10)
    return JSON.stringify(status).substring(0, 10)
  }

  const formatMemoryMB = (bytes: number): string => {
    return (bytes / 1024 / 1024).toFixed(1)
  }

  if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading processes…</div>

  if (error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Processes</h1>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <div className="text-red-800 dark:text-red-300 font-semibold mb-2">Error Loading Processes</div>
          <div className="text-red-700 dark:text-red-400 text-sm mb-4">{error}</div>
          <div className="text-red-700 dark:text-red-400 text-sm bg-red-100 dark:bg-red-900/30 p-3 rounded">
            <strong>Fix:</strong> Try running with elevated permissions:
            <div className="font-mono mt-2 bg-white dark:bg-gray-800 p-2 rounded text-gray-900 dark:text-gray-100">sudo npm run tauri:dev</div>
          </div>
        </div>
      </div>
    )
  }

  const totalPages = Math.ceil(filteredProcesses.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const paginatedProcesses = filteredProcesses.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Processes</h1>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {paginatedProcesses.length > 0
            ? `${startIndex + 1}–${Math.min(startIndex + ITEMS_PER_PAGE, filteredProcesses.length)} of ${filteredProcesses.length}`
            : `0 of ${filteredProcesses.length}`}
        </div>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-3 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Search by process name or PID…"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setCurrentPage(1)
          }}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        />
        {searchQuery && (
          <button
            onClick={resetSearch}
            className="absolute right-3 top-3 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        {paginatedProcesses.length === 0 ? (
          <div className="text-gray-600 dark:text-gray-400">No processes found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="p-2">PID</th>
                  <th className="p-2">Name</th>
                  <th className="p-2 text-right">CPU %</th>
                  <th className="p-2 text-right">Memory (MB)</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProcesses.map((p) => {
                  const isConfirmingDelete = pendingDeletePid === p.pid

                  return (
                    <tr key={p.pid} className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="p-2 text-gray-900 dark:text-gray-100 font-mono text-sm">{p.pid}</td>
                      <td className="p-2 text-gray-900 dark:text-gray-100 font-mono text-sm truncate max-w-xs" title={p.name}>
                        {p.name}
                      </td>
                      <td className="p-2 text-gray-600 dark:text-gray-400 text-right">
                        {typeof p.cpu === 'number' ? p.cpu.toFixed(1) : p.cpu}%
                      </td>
                      <td className="p-2 text-gray-600 dark:text-gray-400 text-right">
                        {typeof p.memory === 'number' ? formatMemoryMB(p.memory) : p.memory}
                      </td>
                      <td className="p-2 text-gray-600 dark:text-gray-400 text-xs">
                        {formatProcessStatus(p.status)}
                      </td>
                      <td className="p-2 text-right">
                        {isConfirmingDelete ? (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleDeleteProcess(p.pid)}
                              disabled={isDeleting}
                              className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 disabled:opacity-50"
                            >
                              {isDeleting ? 'Killing…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setPendingDeletePid(null)}
                              disabled={isDeleting}
                              className="px-2 py-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setPendingDeletePid(p.pid)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-xs"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
            Previous
          </button>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            Page {totalPages === 0 ? 0 : currentPage} of {totalPages}
          </div>
          <button
            onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages || totalPages === 0}
            className="flex items-center gap-2 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}


