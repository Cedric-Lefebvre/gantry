import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { ChevronDown, ChevronRight, ChevronUp, Search, Trash2, X, Layers, RefreshCw } from 'lucide-react'
import { useResourceMonitor } from '../hooks/useResourceMonitor'
import Pagination from '../components/Pagination'

interface ProcessEntry {
  pid: number
  parent_pid: number | null
  name: string
  exe: string
  cpu: number
  memory: number
  status: string
}

interface ProcessGroup {
  name: string
  icon: string
  total_cpu: number
  total_memory: number
  count: number
  main_pid: number
  processes: ProcessEntry[]
}

const ITEMS_PER_PAGE = 50

const formatMemory = (bytes: number): string => {
  const mb = bytes / 1024 / 1024
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb.toFixed(1) + ' MB'
}

const formatCpu = (cpu: number): string => {
  return cpu.toFixed(1) + '%'
}

const memoryColor = (bytes: number, totalMemory: number): string => {
  if (totalMemory <= 0) return 'text-gray-500 dark:text-gray-400'
  const pct = (bytes / totalMemory) * 100
  if (pct >= 25) return 'text-red-500 font-medium'
  if (pct >= 10) return 'text-orange-500 font-medium'
  if (pct >= 5) return 'text-amber-500'
  return 'text-gray-500 dark:text-gray-400'
}

function ProcessGroupRow({ group, onKillGroup, onKillProcess, totalMemory }: {
  group: ProcessGroup
  onKillGroup: (pids: number[]) => void
  onKillProcess: (pid: number) => void
  totalMemory: number
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirmKill, setConfirmKill] = useState<'group' | number | null>(null)

  return (
    <>
      <tr
        className="border-t border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="p-2 w-8">
          {group.count > 1 ? (
            expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />
          ) : <div className="w-3.5" />}
        </td>
        <td className="p-2 text-gray-900 dark:text-gray-100 font-medium text-sm">
          <div className="flex items-center gap-2">
            {group.name}
            {group.count > 1 && (
              <span className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full">
                {group.count}
              </span>
            )}
          </div>
        </td>
        <td className="p-2 text-right text-sm">
          <span className={group.total_cpu > 50 ? 'text-red-500 font-medium' : group.total_cpu > 10 ? 'text-amber-500' : 'text-gray-500 dark:text-gray-400'}>
            {formatCpu(group.total_cpu)}
          </span>
        </td>
        <td className="p-2 text-right text-sm">
          <span className={memoryColor(group.total_memory, totalMemory)}>
            {formatMemory(group.total_memory)}
          </span>
        </td>
        <td className="p-2 text-right">
          {confirmKill === 'group' ? (
            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { onKillGroup(group.processes.map(p => p.pid)); setConfirmKill(null) }}
                className="px-2 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
              >
                Kill All
              </button>
              <button
                onClick={() => setConfirmKill(null)}
                className="px-2 py-1 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmKill('group') }}
              className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            >
              <Trash2 size={14} />
            </button>
          )}
        </td>
      </tr>

      {expanded && group.processes.map((proc) => (
        <tr
          key={proc.pid}
          className="border-t border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50"
        >
          <td className="p-2" />
          <td className="p-2 pl-6 text-sm">
            <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
              <span className="font-mono text-xs text-gray-400 dark:text-gray-500">{proc.pid}</span>
              <span className="truncate max-w-xs">{proc.name}</span>
            </div>
          </td>
          <td className="p-2 text-right text-xs text-gray-500 dark:text-gray-400">{formatCpu(proc.cpu)}</td>
          <td className="p-2 text-right text-xs text-gray-500 dark:text-gray-400">{formatMemory(proc.memory)}</td>
          <td className="p-2 text-right">
            {confirmKill === proc.pid ? (
              <div className="flex items-center justify-end gap-1">
                <button
                  onClick={() => { onKillProcess(proc.pid); setConfirmKill(null) }}
                  className="px-2 py-0.5 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                >
                  Kill
                </button>
                <button
                  onClick={() => setConfirmKill(null)}
                  className="px-2 py-0.5 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 text-xs rounded"
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmKill(proc.pid)}
                className="p-1 text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded opacity-60 hover:opacity-100"
              >
                <Trash2 size={12} />
              </button>
            )}
          </td>
        </tr>
      ))}
    </>
  )
}

export default function Processes() {
  const { resources } = useResourceMonitor()
  const totalMemory = resources?.memory?.total ?? 0
  const [groups, setGroups] = useState<ProcessGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [sortKey, setSortKey] = useState<'name' | 'cpu' | 'memory'>('memory')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [autoRefresh, setAutoRefresh] = useState(false)

  useEffect(() => {
    fetchProcesses()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(fetchProcesses, 5000)
    return () => clearInterval(id)
  }, [autoRefresh])

  const fetchProcesses = async () => {
    try {
      const data = await invoke<ProcessGroup[]>('list_processes')
      setGroups(data || [])
    } catch (err) {
      console.error('Failed to load processes:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleKillProcess = async (pid: number) => {
    try {
      await invoke('kill_process', { pid })
      await fetchProcesses()
    } catch (err) {
      alert(`Failed to kill process: ${err}`)
    }
  }

  const handleKillGroup = async (pids: number[]) => {
    try {
      await invoke('kill_process_group', { pids })
      await fetchProcesses()
    } catch (err) {
      alert(`Failed to kill processes: ${err}`)
    }
  }

  const toggleSort = (key: 'name' | 'cpu' | 'memory') => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const filteredGroups = groups.filter(g =>
    g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    g.processes.some(p => p.pid.toString().includes(searchQuery))
  ).sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortKey === 'name') return mul * a.name.localeCompare(b.name)
    if (sortKey === 'cpu') return mul * (a.total_cpu - b.total_cpu)
    return mul * (a.total_memory - b.total_memory)
  })

  const totalPages = Math.ceil(filteredGroups.length / ITEMS_PER_PAGE)
  const paginatedGroups = filteredGroups.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  )

  const totalProcessCount = groups.reduce((sum, g) => sum + g.count, 0)

  useEffect(() => {
    setCurrentPage(1)
  }, [searchQuery])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Processes</h1>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-16">
          <div className="flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 dark:text-gray-400">Loading processes...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Processes</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
            <Layers size={14} />
            <span>{filteredGroups.length} apps</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span>{totalProcessCount} total</span>
          </div>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              autoRefresh
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            <RefreshCw size={13} className={autoRefresh ? 'animate-spin' : ''} />
            Live
          </button>
          <button
            onClick={fetchProcesses}
            className="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search by app name or PID..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="p-2 w-8" />
                <th className="p-2 text-left text-sm font-semibold text-gray-900 dark:text-gray-100 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('name')}>
                  <div className="flex items-center gap-1">
                    Application
                    {sortKey === 'name' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                </th>
                <th className="p-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 w-24 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('cpu')}>
                  <div className="flex items-center justify-end gap-1">
                    CPU
                    {sortKey === 'cpu' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                </th>
                <th className="p-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 w-28 cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors" onClick={() => toggleSort('memory')}>
                  <div className="flex items-center justify-end gap-1">
                    Memory
                    {sortKey === 'memory' && (sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
                  </div>
                </th>
                <th className="p-2 text-right text-sm font-semibold text-gray-900 dark:text-gray-100 w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedGroups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500 dark:text-gray-400">
                    {searchQuery ? 'No processes match your search' : 'No processes found'}
                  </td>
                </tr>
              ) : (
                paginatedGroups.map((group) => (
                  <ProcessGroupRow
                    key={group.name}
                    group={group}
                    onKillGroup={handleKillGroup}
                    onKillProcess={handleKillProcess}
                    totalMemory={totalMemory}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">{filteredGroups.length} apps</span>
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} />
        </div>
      )}
    </div>
  )
}
